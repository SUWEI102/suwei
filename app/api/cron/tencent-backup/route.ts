import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rentals } from '@/lib/db/schema'
import { backupChecksum, buildBackup, countBackupRecords } from '@/lib/backup'
import { pruneTencentSnapshots, saveTencentSnapshot } from '@/lib/tencent-backup'

export const maxDuration = 300

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: '未授权的定时任务请求' }, { status: 401 })
  }

  const rows = await db.selectDistinct({ userId: rentals.userId }).from(rentals)
  const results = []
  for (const { userId } of rows) {
    try {
      const payload = await buildBackup(userId)
      await saveTencentSnapshot({
        userId,
        backupType: 'scheduled',
        schemaVersion: payload.schemaVersion,
        recordCount: countBackupRecords(payload),
        checksum: backupChecksum(payload),
        payload,
      })
      results.push({ userId, status: 'ready' })
    } catch (error) {
      results.push({ userId, status: 'failed', error: error instanceof Error ? error.message : '异地备份失败' })
    }
  }
  const pruned = await pruneTencentSnapshots(90)
  return NextResponse.json({ processed: results.length, pruned, results })
}
