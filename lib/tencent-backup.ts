import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import mysql, { type Pool } from 'mysql2/promise'
import type { BackupPayload } from '@/lib/backup'

const HOST = 'gz-cynosdbmysql-grp-qwlhed05.sql.tencentcdb.com'
const PORT = 27462
const DATABASE = 'suwei_rental'
const USER = 'suwei_app'
let pool: Pool | undefined

function getPassword(raw: string) {
  try {
    const url = new URL(raw)
    if (url.password) return decodeURIComponent(url.password)
  } catch {}
  for (const pattern of [/密码\s*[:：]\s*([^\s@]+)/i, /suwei_app\s*[:：]\s*([^\s@]+)/i, /password\s*[:：=]\s*([^\s@]+)/i]) {
    const match = raw.match(pattern)
    if (match?.[1]) return match[1]
  }
  throw new Error('腾讯云 MySQL 连接配置缺少密码')
}

function getPool() {
  if (pool) return pool
  const raw = process.env.TENCENT_MYSQL_URL
  if (!raw) throw new Error('TENCENT_MYSQL_URL 未配置')
  const ca = process.env.TENCENT_MYSQL_CA?.replace(/\\n/g, '\n')
  pool = mysql.createPool({
    host: HOST,
    port: PORT,
    database: DATABASE,
    user: USER,
    password: getPassword(raw),
    ssl: ca?.includes('BEGIN CERTIFICATE') ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 3,
    enableKeepAlive: true,
    connectTimeout: 10_000,
  })
  return pool
}

function encryptionKey() {
  const secret = process.env.TENCENT_BACKUP_KEY
  if (!secret) throw new Error('TENCENT_BACKUP_KEY 未配置')
  return /^[0-9a-f]{64}$/i.test(secret) ? Buffer.from(secret, 'hex') : createHash('sha256').update(secret).digest()
}

function encrypt(payload: BackupPayload) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(payload))), cipher.final()])
  return { ciphertext, iv, tag: cipher.getAuthTag() }
}

function decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(ciphertext), decipher.final()])).toString('utf8')) as BackupPayload
}

async function ensureTable() {
  await getPool().execute(`CREATE TABLE IF NOT EXISTS suwei_backup_snapshots (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(191) NOT NULL,
    backup_type VARCHAR(32) NOT NULL,
    schema_version INT NOT NULL,
    record_count INT NOT NULL,
    checksum CHAR(64) NOT NULL,
    ciphertext LONGBLOB NOT NULL,
    iv BINARY(12) NOT NULL,
    auth_tag BINARY(16) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_user_checksum (user_id, checksum),
    KEY idx_user_created (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
}

export async function saveTencentSnapshot(input: { userId: string; backupType: string; schemaVersion: number; recordCount: number; checksum: string; payload: BackupPayload }) {
  await ensureTable()
  const encrypted = encrypt(input.payload)
  await getPool().execute(
    `INSERT INTO suwei_backup_snapshots (user_id, backup_type, schema_version, record_count, checksum, ciphertext, iv, auth_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE backup_type = VALUES(backup_type)`,
    [input.userId, input.backupType, input.schemaVersion, input.recordCount, input.checksum, encrypted.ciphertext, encrypted.iv, encrypted.tag],
  )
  return { status: 'ready' as const, checksum: input.checksum }
}

export async function listTencentSnapshots(userId: string) {
  await ensureTable()
  const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
    `SELECT id, backup_type AS backupType, schema_version AS schemaVersion, record_count AS recordCount,
            checksum, created_at AS createdAt
     FROM suwei_backup_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    [userId],
  )
  return rows
}

export async function getTencentSnapshot(userId: string, id: number) {
  await ensureTable()
  const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
    'SELECT ciphertext, iv, auth_tag AS authTag FROM suwei_backup_snapshots WHERE user_id = ? AND id = ? LIMIT 1',
    [userId, id],
  )
  const row = rows[0]
  if (!row) throw new Error('腾讯云备份不存在')
  return decrypt(row.ciphertext, row.iv, row.authTag)
}

export async function pruneTencentSnapshots(retentionDays = 90) {
  await ensureTable()
  const [result] = await getPool().execute<mysql.ResultSetHeader>(
    'DELETE FROM suwei_backup_snapshots WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)',
    [retentionDays],
  )
  return result.affectedRows
}

export async function testTencentConnection() {
  await ensureTable()
  await getPool().query('SELECT 1')
  return { connected: true as const, tls: true as const, database: DATABASE }
}
