import ExcelJS from 'exceljs'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAccessContext } from '@/lib/access'
import { formatDeviceConfig } from '@/lib/device-config'
import { db } from '@/lib/db'
import {
  accountLedger,
  businessSettings,
  buyoutRecords,
  lossRecords,
  organizationMembers,
  paymentRecords,
  receivableBills,
  rentalEvents,
  rentalItems,
  rentals,
  renewalRecords,
  returnRecords,
  user,
} from '@/lib/db/schema'

export const runtime = 'nodejs'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

function safeCell(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Array<{ header: string; key: string; width?: number }>, rows: Record<string, unknown>[]) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = columns
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.min(columns.length, 26))}1` }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B6B4F' } }
  for (const row of rows) sheet.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)])))
  sheet.eachRow((row) => { row.alignment = { vertical: 'middle', wrapText: true } })
}

export async function GET(request: NextRequest) {
  try {
    const access = await getAccessContext('系统设置')
    if (access.role !== 'admin') return NextResponse.json({ error: '仅管理员可以导出完整数据' }, { status: 403 })
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) return NextResponse.json({ error: '日期格式无效' }, { status: 400 })
    const { from, to } = parsed.data
    if (from && to && from > to) return NextResponse.json({ error: '开始日期不能晚于结束日期' }, { status: 400 })
    const userId = access.userId
    const dateFilters = <T,>(column: T) => {
      const filters = [eq(rentals.userId, userId)]
      if (from) filters.push(gte(column as never, from) as never)
      if (to) filters.push(lte(column as never, to) as never)
      return filters
    }

    const [rentalRows, allContracts, itemRows, paymentRows, billRows, ledgerRows, renewalRows, buyoutRows, returnRows, lossRows, eventRows, memberRows, [settings]] = await Promise.all([
      db.select().from(rentals).where(and(...dateFilters(rentals.startDate))).orderBy(asc(rentals.id)),
      db.select({ id: rentals.id, contractNo: rentals.contractNo }).from(rentals).where(eq(rentals.userId, userId)),
      db.select().from(rentalItems).where(eq(rentalItems.userId, userId)).orderBy(asc(rentalItems.rentalId), asc(rentalItems.id)),
      db.select().from(paymentRecords).where(and(eq(paymentRecords.userId, userId), ...(from ? [gte(paymentRecords.paymentDate, from)] : []), ...(to ? [lte(paymentRecords.paymentDate, to)] : []))).orderBy(asc(paymentRecords.paymentDate)),
      db.select().from(receivableBills).where(and(eq(receivableBills.userId, userId), ...(from ? [gte(receivableBills.dueDate, from)] : []), ...(to ? [lte(receivableBills.dueDate, to)] : []))).orderBy(asc(receivableBills.dueDate)),
      db.select().from(accountLedger).where(and(eq(accountLedger.userId, userId), ...(from ? [gte(accountLedger.entryDate, from)] : []), ...(to ? [lte(accountLedger.entryDate, to)] : []))).orderBy(asc(accountLedger.entryDate)),
      db.select().from(renewalRecords).where(and(eq(renewalRecords.userId, userId), ...(from ? [gte(renewalRecords.renewalDate, from)] : []), ...(to ? [lte(renewalRecords.renewalDate, to)] : []))).orderBy(asc(renewalRecords.renewalDate)),
      db.select().from(buyoutRecords).where(and(eq(buyoutRecords.userId, userId), ...(from ? [gte(buyoutRecords.buyoutDate, from)] : []), ...(to ? [lte(buyoutRecords.buyoutDate, to)] : []))).orderBy(asc(buyoutRecords.buyoutDate)),
      db.select().from(returnRecords).where(and(eq(returnRecords.userId, userId), ...(from ? [gte(returnRecords.returnDate, from)] : []), ...(to ? [lte(returnRecords.returnDate, to)] : []))).orderBy(asc(returnRecords.returnDate)),
      db.select().from(lossRecords).where(and(eq(lossRecords.userId, userId), ...(from ? [gte(lossRecords.lossDate, from)] : []), ...(to ? [lte(lossRecords.lossDate, to)] : []))).orderBy(asc(lossRecords.lossDate)),
      db.select().from(rentalEvents).where(and(eq(rentalEvents.userId, userId), ...(from ? [gte(rentalEvents.eventDate, from)] : []), ...(to ? [lte(rentalEvents.eventDate, to)] : []))).orderBy(asc(rentalEvents.eventDate)),
      db.select({ name: user.name, email: user.email, role: organizationMembers.role, active: organizationMembers.active, permissions: organizationMembers.permissions, updatedAt: organizationMembers.updatedAt }).from(organizationMembers).innerJoin(user, eq(user.id, organizationMembers.memberUserId)).where(eq(organizationMembers.ownerId, userId)),
      db.select({ storeName: businessSettings.storeName }).from(businessSettings).where(eq(businessSettings.userId, userId)).limit(1),
    ])

    const contractMap = new Map(allContracts.map((row) => [row.id, row.contractNo]))
    const workbook = new ExcelJS.Workbook()
    workbook.creator = settings?.storeName?.trim() || '速维租赁管理'
    workbook.created = new Date()

    addSheet(workbook, '租赁合同', [
      { header: '合同编号', key: 'contractNo', width: 20 }, { header: '客户公司', key: 'customerCompany', width: 28 }, { header: '联系人', key: 'customerName', width: 18 }, { header: '联系电话', key: 'customerPhone', width: 16 }, { header: '地址', key: 'customerAddress', width: 28 }, { header: '设备概览', key: 'deviceName', width: 32 }, { header: '数量', key: 'quantity', width: 10 }, { header: '开始日期', key: 'startDate', width: 14 }, { header: '结束日期', key: 'endDate', width: 14 }, { header: '月租合计', key: 'monthlyRent', width: 14 }, { header: '租金总额', key: 'totalRent', width: 14 }, { header: '约定押金', key: 'deposit', width: 14 }, { header: '已收租金', key: 'paidAmount', width: 14 }, { header: '收款状态', key: 'paymentStatus', width: 12 }, { header: '合同状态', key: 'status', width: 12 }, { header: '备注', key: 'notes', width: 30 },
    ], rentalRows)
    addSheet(workbook, '设备明细', [
      { header: '合同编号', key: 'contractNo', width: 20 }, { header: '设备名称', key: 'deviceName', width: 24 }, { header: '类型', key: 'deviceType', width: 12 }, { header: '设备编号', key: 'deviceCode', width: 18 }, { header: '数量', key: 'quantity', width: 10 }, { header: '已买断', key: 'boughtOutQuantity', width: 10 }, { header: '已退租', key: 'returnedQuantity', width: 10 }, { header: '已丢失', key: 'lostQuantity', width: 10 }, { header: '开始日期', key: 'startDate', width: 14 }, { header: '结束日期', key: 'endDate', width: 14 }, { header: '月租', key: 'monthlyRent', width: 14 }, { header: '配置', key: 'configuration', width: 45 },
    ], itemRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId, configuration: formatDeviceConfig(row, true) })))
    addSheet(workbook, '收款记录', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '收款日期', key: 'paymentDate', width: 14 }, { header: '金额', key: 'amount', width: 14 }, { header: '费用类型', key: 'feeType', width: 14 }, { header: '支付方式', key: 'paymentMethod', width: 14 }, { header: '经办人', key: 'operatorName', width: 16 }, { header: '备注', key: 'notes', width: 30 }], paymentRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '月度应收账单', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '账单编号', key: 'billNo', width: 22 }, { header: '账期开始', key: 'periodStart', width: 14 }, { header: '账期结束', key: 'periodEnd', width: 14 }, { header: '到期日', key: 'dueDate', width: 14 }, { header: '账单类型', key: 'billType', width: 16 }, { header: '应收金额', key: 'amount', width: 14 }, { header: '已收金额', key: 'paidAmount', width: 14 }, { header: '状态', key: 'status', width: 12 }, { header: '备注', key: 'notes', width: 30 }], billRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '押金与冲正流水', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '日期', key: 'entryDate', width: 14 }, { header: '流水类型', key: 'entryType', width: 18 }, { header: '金额', key: 'amount', width: 14 }, { header: '关联收款号', key: 'paymentRecordId', width: 14 }, { header: '经办人', key: 'operatorName', width: 16 }, { header: '备注', key: 'notes', width: 32 }], ledgerRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '续租记录', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '续租日期', key: 'renewalDate', width: 14 }, { header: '数量', key: 'quantity', width: 10 }, { header: '计费单位', key: 'billingUnit', width: 12 }, { header: '时长', key: 'duration', width: 10 }, { header: '续租金额', key: 'renewalAmount', width: 14 }, { header: '原到期日', key: 'oldEndDate', width: 14 }, { header: '新到期日', key: 'newEndDate', width: 14 }, { header: '备注', key: 'notes', width: 30 }], renewalRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '买断记录', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '买断日期', key: 'buyoutDate', width: 14 }, { header: '数量', key: 'quantity', width: 10 }, { header: '单价', key: 'unitPrice', width: 14 }, { header: '金额', key: 'amount', width: 14 }, { header: '备注', key: 'notes', width: 30 }], buyoutRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '退租记录', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '退租日期', key: 'returnDate', width: 14 }, { header: '数量', key: 'quantity', width: 10 }, { header: '设备状况', key: 'condition', width: 16 }, { header: '扣款', key: 'deductionAmount', width: 14 }, { header: '退还押金', key: 'depositRefund', width: 14 }, { header: '经办人', key: 'operatorName', width: 16 }, { header: '备注', key: 'notes', width: 30 }], returnRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '丢失记录', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '丢失日期', key: 'lossDate', width: 14 }, { header: '数量', key: 'quantity', width: 10 }, { header: '赔偿单价', key: 'unitCompensation', width: 14 }, { header: '赔偿金额', key: 'amount', width: 14 }, { header: '经办人', key: 'operatorName', width: 16 }, { header: '备注', key: 'notes', width: 30 }], lossRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '变更维修记录', [{ header: '合同编号', key: 'contractNo', width: 20 }, { header: '类型', key: 'eventType', width: 14 }, { header: '状态', key: 'status', width: 12 }, { header: '发生日期', key: 'eventDate', width: 14 }, { header: '变更原因', key: 'reason', width: 28 }, { header: '应收调整', key: 'feeAdjustment', width: 14 }, { header: '维修成本', key: 'repairCost', width: 14 }, { header: '客户承担', key: 'customerCharge', width: 14 }, { header: '故障描述', key: 'faultDescription', width: 32 }, { header: '处理方式', key: 'resolution', width: 32 }, { header: '完成日期', key: 'completedDate', width: 14 }, { header: '经办人', key: 'operatorName', width: 16 }, { header: '备注', key: 'notes', width: 30 }], eventRows.map((row) => ({ ...row, contractNo: contractMap.get(row.rentalId) || row.rentalId })))
    addSheet(workbook, '员工账号', [{ header: '姓名', key: 'name', width: 20 }, { header: '邮箱', key: 'email', width: 28 }, { header: '角色', key: 'role', width: 12 }, { header: '状态', key: 'status', width: 12 }, { header: '权限', key: 'permissions', width: 42 }, { header: '更新时间', key: 'updatedAt', width: 22 }], memberRows.map((row) => ({ ...row, status: row.active ? '正常' : '停用' })))

    const buffer = await workbook.xlsx.writeBuffer()
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    return new NextResponse(Buffer.from(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="suwei-backup-${stamp}.xlsx"`, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败'
    return NextResponse.json({ error: message }, { status: message === '未登录' ? 401 : 403 })
  }
}
