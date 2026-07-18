import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/access'
import { backupChecksum, countBackupRecords, restoreBackup, validateBackup } from '@/lib/backup'

function translateRestoreError(error: unknown) {
  const raw = error instanceof Error ? error.message : '恢复失败'
  if (raw.includes('toISOString is not a function')) return '备份中的时间字段格式不正确，恢复已停止，现有数据未被修改'
  if (raw.includes('duplicate key')) return '备份中存在重复编号，恢复已停止，现有数据未被修改'
  if (raw.includes('violates not-null constraint')) return '备份缺少必要字段，恢复已停止，现有数据未被修改'
  if (raw.includes('invalid input syntax')) return '备份中存在格式错误的数据，恢复已停止，现有数据未被修改'
  return raw
}

export async function POST(request: Request) {
  try {
    const { userId, role } = await getAccessContext('系统设置')
    if (role !== 'admin') return NextResponse.json({ error: '仅管理员可恢复数据' }, { status: 403 })
    const body = await request.json() as { mode?: 'preview' | 'restore'; payload?: unknown; confirmation?: string }
    const payload = validateBackup(body.payload, userId)
    const summary = { createdAt: payload.createdAt, schemaVersion: payload.schemaVersion, recordCount: countBackupRecords(payload), checksum: backupChecksum(payload), counts: Object.fromEntries(Object.entries(payload.tables).map(([name, rows]) => [name, rows.length])) }
    if (body.mode !== 'restore') return NextResponse.json({ summary })
    if (body.confirmation !== '确认恢复') return NextResponse.json({ error: '请输入“确认恢复”后再执行' }, { status: 400 })
    return NextResponse.json({ restored: await restoreBackup(userId, payload) })
  } catch (error) { return NextResponse.json({ error: translateRestoreError(error) }, { status: 400 }) }
}
