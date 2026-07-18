import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accountLedger, backupSnapshots, businessSettings, buyoutRecords, contractSnapshots, customerPortals, lossRecords, paymentAllocations, paymentRecords, receivableBills, renewalRecords, rentalEvents, rentalItems, rentals, returnRecords } from '@/lib/db/schema'

export const BACKUP_VERSION = 1
export const backupTables = { rentals, rentalItems, buyoutRecords, renewalRecords, paymentRecords, receivableBills, paymentAllocations, accountLedger, rentalEvents, returnRecords, lossRecords, businessSettings, contractSnapshots, customerPortals } as const
export type BackupPayload = { format: 'suwei-rental-backup'; schemaVersion: number; createdAt: string; userId: string; tables: Record<string, unknown[]> }

export async function buildBackup(userId: string): Promise<BackupPayload> {
  const entries = await Promise.all(Object.entries(backupTables).map(async ([name, table]) => [name, await db.select().from(table).where(eq(table.userId, userId))] as const))
  return { format: 'suwei-rental-backup', schemaVersion: BACKUP_VERSION, createdAt: new Date().toISOString(), userId, tables: Object.fromEntries(entries) }
}
export function backupChecksum(payload: BackupPayload) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
export function countBackupRecords(payload: BackupPayload) { return Object.values(payload.tables).reduce((sum, rows) => sum + rows.length, 0) }
export function validateBackup(value: unknown, userId: string) {
  if (!value || typeof value !== 'object') throw new Error('备份文件格式无效')
  const payload = value as BackupPayload
  if (payload.format !== 'suwei-rental-backup') throw new Error('不是本系统生成的恢复包')
  if (payload.schemaVersion !== BACKUP_VERSION) throw new Error(`备份版本 ${payload.schemaVersion} 与当前版本 ${BACKUP_VERSION} 不兼容`)
  if (payload.userId !== userId) throw new Error('备份所属账号与当前门店不匹配')
  for (const name of Object.keys(backupTables)) if (!Array.isArray(payload.tables?.[name])) throw new Error(`备份缺少数据表：${name}`)
  return payload
}
export async function saveCloudSnapshot(userId: string, backupType = 'scheduled') {
  const payload = await buildBackup(userId)
  const [snapshot] = await db.insert(backupSnapshots).values({ userId, backupType, schemaVersion: BACKUP_VERSION, recordCount: countBackupRecords(payload), checksum: backupChecksum(payload), payload }).returning()
  return snapshot
}
export async function listCloudSnapshots(userId: string) { return db.select({ id: backupSnapshots.id, backupType: backupSnapshots.backupType, schemaVersion: backupSnapshots.schemaVersion, recordCount: backupSnapshots.recordCount, checksum: backupSnapshots.checksum, status: backupSnapshots.status, createdAt: backupSnapshots.createdAt }).from(backupSnapshots).where(eq(backupSnapshots.userId, userId)).orderBy(desc(backupSnapshots.createdAt)).limit(20) }
export async function getCloudSnapshot(userId: string, id: number) { const [row] = await db.select().from(backupSnapshots).where(and(eq(backupSnapshots.userId, userId), eq(backupSnapshots.id, id))); if (!row) throw new Error('备份不存在'); return row }

function hydrateBackupRow(row: unknown) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (['createdAt', 'updatedAt', 'expiresAt', 'lockedUntil', 'lastLoginAt', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'].includes(key) && typeof value === 'string') {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) throw new Error(`备份中的日期字段 ${key} 无效`)
      return [key, parsed]
    }
    return [key, value]
  }))
}

export async function restoreBackup(userId: string, rawPayload: unknown) {
  const payload = validateBackup(rawPayload, userId)
  await saveCloudSnapshot(userId, 'pre-restore')
  const deletionOrder = [paymentAllocations, accountLedger, paymentRecords, receivableBills, rentalEvents, returnRecords, lossRecords, buyoutRecords, renewalRecords, contractSnapshots, customerPortals, rentalItems, rentals, businessSettings] as const
  await db.transaction(async (tx) => {
    for (const table of deletionOrder) await tx.delete(table).where(eq(table.userId, userId))
    for (const [name, table] of Object.entries(backupTables)) {
      const rows = payload.tables[name]
      if (rows.length) await tx.insert(table).values(rows.map(hydrateBackupRow) as never)
    }
  })
  return { recordCount: countBackupRecords(payload), checksum: backupChecksum(payload) }
}
