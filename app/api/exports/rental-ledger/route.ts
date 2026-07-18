import ExcelJS from 'exceljs'
import { asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/access'
import { formatDeviceConfig } from '@/lib/device-config'
import { db } from '@/lib/db'
import { rentalItems, rentals } from '@/lib/db/schema'

export const runtime = 'nodejs'

const safe = (value: unknown) => {
  const text = value == null ? '' : String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: 'AC1' }
  const header = sheet.getRow(1)
  header.height = 28
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  header.eachCell((cell, column) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column <= 15 ? 'FF166534' : 'FF075985' } }
  })
  sheet.eachRow((row, index) => {
    if (index > 1) row.alignment = { vertical: 'middle', wrapText: true }
  })
}

export async function GET() {
  try {
    const access = await getAccessContext('资金查看')
    const [contracts, items] = await Promise.all([
      db.select().from(rentals).where(eq(rentals.userId, access.userId)).orderBy(asc(rentals.id)),
      db.select().from(rentalItems).where(eq(rentalItems.userId, access.userId)).orderBy(asc(rentalItems.rentalId), asc(rentalItems.id)),
    ])
    const contractMap = new Map(contracts.map(row => [row.id, row]))
    const workbook = new ExcelJS.Workbook()
    workbook.creator = '速维租赁管理'
    const columns = [
      ['租赁开始时间', 'startDate', 14], ['机器号', 'machineNo', 14], ['电脑配置', 'configuration', 46], ['原始数量', 'originalQuantity', 10], ['在租数量', 'activeQuantity', 10], ['租赁人', 'customerName', 18], ['租赁期间', 'period', 26], ['租金', 'rentText', 18], ['每月租金', 'periodRent', 14], ['已付租金', 'paidRent', 14], ['租赁结束时间', 'endDate', 14], ['到期提醒', 'expiry', 16], ['备注', 'notes', 36], ['租赁情况', 'status', 12], ['位置', 'location', 20],
      ['合同编号*', 'contractNo', 20], ['客户电话*', 'customerPhone', 16], ['客户公司', 'customerCompany', 24], ['联系人*', 'contactName', 18], ['设备类型*', 'deviceType', 14], ['设备名称*', 'deviceName', 22], ['设备编号', 'deviceCode', 18], ['计费方式*', 'billingType', 12], ['租赁整数*', 'duration', 12], ['单价（元/台/期）*', 'unitPrice', 18], ['押金（元）', 'deposit', 14], ['已收租金（元）', 'paidAmount', 16], ['导出状态', 'exportStatus', 14], ['数据说明', 'dataNotes', 34],
    ] as const
    const monthsBetween = (start: string, end: string) => {
      const a = new Date(`${start}T00:00:00`)
      const b = new Date(`${end}T00:00:00`)
      return Math.max(1, Math.round((b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + (b.getDate() - a.getDate()) / 30))
    }
    const createSheet = (name: string, source: typeof items) => {
      const sheet = workbook.addWorksheet(name)
      sheet.columns = columns.map(([header, key, width]) => ({ header, key, width }))
      for (const item of source) {
        const rental = contractMap.get(item.rentalId)
        if (!rental) continue
        const active = Math.max(0, item.quantity - item.boughtOutQuantity - item.returnedQuantity - item.lostQuantity)
        const status = active > 0 && rental.status === '在租' ? '在租' : item.boughtOutQuantity >= item.quantity ? '买断' : '已退租'
        const remainingDays = Math.ceil((new Date(`${item.endDate}T00:00:00`).getTime() - Date.now()) / 86400000)
        sheet.addRow(Object.fromEntries(Object.entries({
          startDate: item.startDate, machineNo: item.deviceCode, configuration: formatDeviceConfig(item, true), originalQuantity: item.quantity, activeQuantity: active,
          customerName: rental.customerName, period: `${item.startDate} 至 ${item.endDate}`, rentText: `${Number(item.monthlyRent)}元/台/月`,
          periodRent: Number(item.monthlyRent) * active, paidRent: Number(rental.paidAmount), endDate: item.endDate, expiry: remainingDays < 0 ? `已过期${Math.abs(remainingDays)}天` : `剩余${remainingDays}天`, notes: rental.notes,
          status, location: rental.customerAddress, contractNo: rental.contractNo, customerPhone: rental.customerPhone, customerCompany: rental.customerCompany, contactName: rental.customerName,
          deviceType: item.deviceType, deviceName: item.deviceName, deviceCode: item.deviceCode, billingType: '月租', duration: monthsBetween(item.startDate || rental.startDate, item.endDate || rental.endDate),
          unitPrice: Number(item.monthlyRent), deposit: Number(rental.deposit), paidAmount: Number(rental.paidAmount), exportStatus: '软件导出', dataNotes: '可按合同编号重新匹配；修改后上传前请保留表头',
        }).map(([key, value]) => [key, safe(value)])))
      }
      styleSheet(sheet)
    }
    const current = items.filter(item => contractMap.get(item.rentalId)?.status === '在租' && item.quantity > item.boughtOutQuantity + item.returnedQuantity + item.lostQuantity)
    const history = items.filter(item => !current.some(active => active.id === item.id))
    createSheet('在租清单', current)
    createSheet('历史清单', history)
    const info = workbook.addWorksheet('填写说明')
    info.addRows([['员工租机明细导出说明'], ['左侧绿色15列延续旧表查看习惯，右侧蓝色列用于与软件精准匹配。'], ['修改数据时请保留合同编号；合同编号是回传匹配的第一依据。'], ['租赁时间必须为整数，单价必须大于0，日期使用 YYYY-MM-DD。'], ['押金与租金分开记录，“已付租金”不包含押金。']])
    info.getColumn(1).width = 90
    info.getRow(1).font = { bold: true, size: 16, color: { argb: 'FF166534' } }
    const buffer = await workbook.xlsx.writeBuffer()
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(Buffer.from(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`租机明细全表-${stamp}.xlsx`)}`, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败'
    return NextResponse.json({ error: message }, { status: message === '未登录' ? 401 : 403 })
  }
}
