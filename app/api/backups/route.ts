import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/access'
import { backupChecksum, buildBackup, countBackupRecords, listCloudSnapshots, saveCloudSnapshot } from '@/lib/backup'
import { listTencentSnapshots, saveTencentSnapshot, testTencentConnection } from '@/lib/tencent-backup'

export async function GET(request: Request) {
  try {
    const { userId, role } = await getAccessContext('系统设置')
    if (role !== 'admin') return NextResponse.json({ error: '仅管理员可访问备份' }, { status: 403 })
    const url = new URL(request.url)
    if (url.searchParams.get('download') === 'json') {
      const payload = await buildBackup(userId)
      return new NextResponse(JSON.stringify(payload, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="rental-backup-${payload.createdAt.slice(0, 10)}.json"`, 'Cache-Control': 'no-store' } })
    }
    const snapshots = await listCloudSnapshots(userId)
    try {
      const [tencentSnapshots, connection] = await Promise.all([listTencentSnapshots(userId), testTencentConnection()])
      return NextResponse.json({ snapshots, tencentSnapshots, tencentConnection: connection })
    } catch (error) {
      return NextResponse.json({ snapshots, tencentSnapshots: [], tencentConnection: { connected: false, error: error instanceof Error ? error.message : '腾讯云连接失败' } })
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '读取备份失败' }, { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const { userId, role } = await getAccessContext('系统设置')
    if (role !== 'admin') return NextResponse.json({ error: '仅管理员可创建备份' }, { status: 403 })
    const body = await request.json().catch(() => ({})) as { type?: string }
    const backupType = body.type === 'exit' ? 'exit' : 'manual'
    const snapshot = await saveCloudSnapshot(userId, backupType)
    const payload = await buildBackup(userId)
    try {
      const tencentSnapshot = await saveTencentSnapshot({ userId, backupType, schemaVersion: payload.schemaVersion, recordCount: countBackupRecords(payload), checksum: backupChecksum(payload), payload })
      return NextResponse.json({ snapshot, tencentSnapshot })
    } catch (error) {
      return NextResponse.json({ snapshot, tencentSnapshot: { status: 'failed', error: error instanceof Error ? error.message : '腾讯云异地备份失败' } })
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '创建备份失败' }, { status: 500 }) }
}
