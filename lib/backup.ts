import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { account, accountLedger, backupSnapshots, businessSettings, buyoutRecords, contractSnapshots, customerPortals, lossRecords, paymentAllocations, paymentRecords, receivableBills, renewalRecords, rentalEvents, rentalItems, rentals, returnRecords, user } from '@/lib/db/schema'

export const BACKUP_VERSION = 2
export const backupTables = { rentals, rentalItems, buyoutRecords, renewalRecords, paymentRecords, receivableBills, paymentAllocations, accountLedger, rentalEvents, returnRecords, lossRecords, businessSettings, contractSnapshots, customerPortals } as const
export type BackupPayload = {
  format: 'suwei-rental-backup'
  schemaVersion: number
  createdAt: string
  userId: string
  tables: Record<string, unknown[]>
  authentication: {
    users: Array<{ id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: Date; updatedAt: Date }>
    accounts: Array<{ id: string; accountId: string; providerId: string; userId: string; password: string | null; createdAt: Date; updatedAt: Date }>
  }
}

export async function buildBackup(userId: string): Promise<BackupPayload> {
  const [entries, users, accounts] = await Promise.all([
    Promise.all(Object.entries(backupTables).map(async ([name, table]) => [name, await db.select().from(table).where(eq(table.userId, userId))] as const)),
    db.select().from(user).where(eq(user.id, userId)),
    db.select({ id: account.id, accountId: account.accountId, providerId: account.providerId, userId: account.userId, password: account.password, createdAt: account.createdAt, updatedAt: account.updatedAt }).from(account).where(eq(account.userId, userId)),
  ])
  return { format: 'suwei-rental-backup', schemaVersion: BACKUP_VERSION, createdAt: new Date().toISOString(), userId, tables: Object.fromEntries(entries), authentication: { users, accounts } }
}
export function backupChecksum(payload: BackupPayload) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
export function countBackupRecords(payload: BackupPayload) {
  return Object.values(payload.tables).reduce((sum, rows) => sum + rows.length, 0) + payload.authentication.users.length + payload.authentication.accounts.length
}
export function validateBackup(value: unknown, userId: string) {
  if (!value || typeof value !== 'object') throw new Error('备份文件格式无效')
  const payload = value as BackupPayload
  if (payload.format !== 'suwei-rental-backup') throw new Error('不是本系统生成的恢复包')
  if (payload.schemaVersion !== BACKUP_VERSION) throw new Error(`备份版本 ${payload.schemaVersion} 与当前版本 ${BACKUP_VERSION} 不兼容`)
  if (payload.userId !== userId) throw new Error('备份所属账号与当前门店不匹配')
  for (const name of Object.keys(backupTables)) if (!Array.isArray(payload.tables?.[name])) throw new Error(`备份缺少数据表：${name}`)
  if (!Array.isArray(payload.authentication?.users) || !Array.isArray(payload.authentication?.accounts)) throw new Error('备份缺少账户认证数据')
  if (payload.authentication.users.some((row) => row.id !== userId) || payload.authentication.accounts.some((row) => row.userId !== userId)) throw new Error('备份包含其他账号的数据')
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
    for (const row of payload.authentication.users) {
      const hydrated = hydrateBackupRow(row) as typeof user.$inferInsert
      await tx.insert(user).values(hydrated).onConflictDoUpdate({ target: user.id, set: { name: hydrated.name, email: hydrated.email, emailVerified: hydrated.emailVerified, image: hydrated.image, updatedAt: hydrated.updatedAt } })
    }
    for (const row of payload.authentication.accounts) {
      const hydrated = hydrateBackupRow(row) as typeof account.$inferInsert
      await tx.insert(account).values(hydrated).onConflictDoUpdate({ target: account.id, set: { accountId: hydrated.accountId, providerId: hydrated.providerId, userId: hydrated.userId, password: hydrated.password, updatedAt: hydrated.updatedAt } })
    }
  })
  return { recordCount: countBackupRecords(payload), checksum: backupChecksum(payload) }
}
