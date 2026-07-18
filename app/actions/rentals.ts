'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getAccessContext } from '@/lib/access'
import { db } from '@/lib/db'
import { accountLedger, buyoutRecords, paymentRecords, receivableBills, renewalRecords, rentalEvents, rentalItems, rentals } from '@/lib/db/schema'

async function getUserId() {
  return (await getAccessContext('租赁操作')).userId
}

const itemSchema = z.object({
  deviceName: z.string().min(2), deviceType: z.enum(['台式机', '笔记本', '显示器', '一体机', '其他']), deviceCode: z.string().optional(), deviceConfig: z.string().optional(),
  quantity: z.coerce.number().int().positive(), monthlyRent: z.coerce.number().nonnegative(), totalRent: z.coerce.number().nonnegative(),
  cpu: z.string().optional(), motherboard: z.string().optional(), memory: z.string().optional(), storage: z.string().optional(), graphicsCard: z.string().optional(), powerSupply: z.string().optional(), caseModel: z.string().optional(), monitorInfo: z.string().optional(), screenSize: z.string().optional(), screenResolution: z.string().optional(), refreshRate: z.string().optional(), panelType: z.string().optional(), ports: z.string().optional(), batteryInfo: z.string().optional(), adapterInfo: z.string().optional(), accessories: z.string().optional(), colorGamut: z.string().optional(),
})
const rentalSchema = z.object({
  contractNo: z.string().min(2), customerName: z.string().min(2), customerPhone: z.string().min(6), customerAddress: z.string().optional(), startDate: z.string().min(1), endDate: z.string().min(1), deposit: z.coerce.number().nonnegative(), notes: z.string().optional(), items: z.array(itemSchema).min(1),
})
export type RentalItemInput = z.infer<typeof itemSchema>
export type RentalInput = z.infer<typeof rentalSchema>

export async function getRentals(query = '', status = '全部') {
  const userId = await getUserId()
  const filters = [eq(rentals.userId, userId)]
  if (query) filters.push(or(ilike(rentals.contractNo, `%${query}%`), ilike(rentals.customerName, `%${query}%`), ilike(rentals.customerPhone, `%${query}%`), ilike(rentals.deviceName, `%${query}%`))!)
  if (status !== '全部') filters.push(eq(rentals.status, status))
  const rows = await db.select().from(rentals).where(and(...filters)).orderBy(desc(rentals.createdAt))
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  const [items, buyouts, renewals, payments, bills, events, ledger] = await Promise.all([
    db.select().from(rentalItems).where(and(eq(rentalItems.userId, userId), inArray(rentalItems.rentalId, ids))).orderBy(rentalItems.id),
    db.select().from(buyoutRecords).where(and(eq(buyoutRecords.userId, userId), inArray(buyoutRecords.rentalId, ids))).orderBy(desc(buyoutRecords.createdAt)),
    db.select().from(renewalRecords).where(and(eq(renewalRecords.userId, userId), inArray(renewalRecords.rentalId, ids))).orderBy(desc(renewalRecords.createdAt)),
    db.select().from(paymentRecords).where(and(eq(paymentRecords.userId, userId), inArray(paymentRecords.rentalId, ids))).orderBy(desc(paymentRecords.createdAt)),
    db.select().from(receivableBills).where(and(eq(receivableBills.userId, userId), inArray(receivableBills.rentalId, ids))).orderBy(receivableBills.dueDate),
    db.select().from(rentalEvents).where(and(eq(rentalEvents.userId, userId), inArray(rentalEvents.rentalId, ids))).orderBy(desc(rentalEvents.createdAt)),
    db.select().from(accountLedger).where(and(eq(accountLedger.userId, userId), inArray(accountLedger.rentalId, ids))).orderBy(desc(accountLedger.createdAt)),
  ])
  return rows.map((row) => ({ ...row, items: items.filter((item) => item.rentalId === row.id), buyoutRecords: buyouts.filter((record) => record.rentalId === row.id), renewalRecords: renewals.filter((record) => record.rentalId === row.id), paymentRecords: payments.filter((record) => record.rentalId === row.id), receivableBills: bills.filter((record) => record.rentalId === row.id), rentalEvents: events.filter((record) => record.rentalId === row.id), accountLedger: ledger.filter((record) => record.rentalId === row.id) }))
}

export async function getDashboard() {
  const userId = await getUserId()
  const [summary] = await db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${rentals.status} = '在租')::int`, overdue: sql<number>`count(*) filter (where ${rentals.status} = '逾期')::int`, revenue: sql<string>`coalesce(sum(${rentals.paidAmount}), 0)`, receivable: sql<string>`coalesce(sum(${rentals.totalRent} - ${rentals.paidAmount}), 0)` }).from(rentals).where(eq(rentals.userId, userId))
  return summary
}

export async function createRental(input: RentalInput) {
  const userId = await getUserId()
  const value = rentalSchema.parse(input)
  if (new Date(value.endDate) < new Date(value.startDate)) throw new Error('结束日期不能早于开始日期')
  const quantity = value.items.reduce((sum, item) => sum + item.quantity, 0)
  const monthlyRent = value.items.reduce((sum, item) => sum + item.monthlyRent, 0)
  const totalRent = value.items.reduce((sum, item) => sum + item.totalRent, 0)
  await db.transaction(async (tx) => {
    const first = value.items[0]
    const [rental] = await tx.insert(rentals).values({ userId, contractNo: value.contractNo, customerName: value.customerName, customerPhone: value.customerPhone, customerAddress: value.customerAddress, startDate: value.startDate, endDate: value.endDate, deposit: String(value.deposit), notes: value.notes, deviceName: value.items.map((item) => item.deviceName).join('、'), deviceType: value.items.length > 1 ? '多设备' : first.deviceType, deviceCode: first.deviceCode, deviceConfig: first.deviceConfig, quantity, monthlyRent: String(monthlyRent), totalRent: String(totalRent), paidAmount: '0', paymentStatus: '待收款', status: '在租' }).returning({ id: rentals.id })
    await tx.insert(rentalItems).values(value.items.map((item) => ({ ...item, userId, rentalId: rental.id, startDate: value.startDate, endDate: value.endDate, monthlyRent: String(item.monthlyRent), totalRent: String(item.totalRent) })))
    let cursor = value.startDate
    let billIndex = 1
    while (cursor <= value.endDate) {
      const start = new Date(`${cursor}T00:00:00Z`)
      const end = new Date(start)
      end.setUTCMonth(end.getUTCMonth() + 1)
      end.setUTCDate(end.getUTCDate() - 1)
      const periodEnd = end.toISOString().slice(0, 10) > value.endDate ? value.endDate : end.toISOString().slice(0, 10)
      await tx.insert(receivableBills).values({ userId, rentalId: rental.id, billNo: `${value.contractNo}-${String(billIndex).padStart(3, '0')}`, periodStart: cursor, periodEnd, dueDate: cursor, billType: '租金', amount: String(monthlyRent), paidAmount: '0', status: '待收' })
      const next = new Date(start)
      next.setUTCMonth(next.getUTCMonth() + 1)
      cursor = next.toISOString().slice(0, 10)
      billIndex += 1
    }
    if (value.deposit > 0) await tx.insert(receivableBills).values({ userId, rentalId: rental.id, billNo: `${value.contractNo}-DEPOSIT`, periodStart: value.startDate, periodEnd: value.startDate, dueDate: value.startDate, billType: '押金', amount: String(value.deposit), paidAmount: '0', status: '待收' })
  })
  revalidatePath('/')
}

const renewalSchema = z.object({ rentalItemId: z.number().int().positive(), quantity: z.number().int().positive(), billingUnit: z.enum(['month', 'day']), duration: z.number().int().min(1).max(3650), unitPrice: z.number().nonnegative(), newEndDate: z.string().min(1), notes: z.string().optional() })
export type RenewalInput = z.infer<typeof renewalSchema>

function addCalendarMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export async function renewRentalItems(rentalId: number, inputs: RenewalInput[]) {
  const userId = await getUserId()
  const values = z.array(renewalSchema).min(1, '请至少选择一项设备').parse(inputs)
  await db.transaction(async (tx) => {
    const [rental] = await tx.select().from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId)))
    if (!rental) throw new Error('租赁合同不存在')
    for (const value of values) {
      const [item] = await tx.select().from(rentalItems).where(and(eq(rentalItems.id, value.rentalItemId), eq(rentalItems.rentalId, rentalId), eq(rentalItems.userId, userId)))
      if (!item) throw new Error('设备明细不存在')
      const oldEndDate = item.endDate ?? rental.endDate
      const startDate = item.startDate ?? rental.startDate
      if (new Date(`${value.newEndDate}T00:00:00`) <= new Date(`${oldEndDate}T00:00:00`)) throw new Error(`${item.deviceName} 的新到期日必须晚于原到期日`)
      const available = item.quantity - item.boughtOutQuantity
      if (value.quantity > available) throw new Error(`${item.deviceName} 最多可续租 ${available} 台`)
      const newEndDate = value.billingUnit === 'month' ? addCalendarMonths(oldEndDate, value.duration) : addCalendarDays(oldEndDate, value.duration)
      if (value.newEndDate !== newEndDate) throw new Error(`${item.deviceName} 的续租时长与到期日不一致`)
      const amount = value.quantity * value.unitPrice * value.duration
      const effectiveMonthlyRent = value.billingUnit === 'month' ? value.unitPrice : value.unitPrice * 30
      let renewedItemId = item.id
      if (value.quantity === available && item.boughtOutQuantity === 0) {
        await tx.update(rentalItems).set({ endDate: newEndDate, monthlyRent: String(effectiveMonthlyRent), totalRent: String(effectiveMonthlyRent * item.quantity), updatedAt: new Date() }).where(and(eq(rentalItems.id, item.id), eq(rentalItems.userId, userId)))
      } else {
        const remainingQuantity = item.quantity - value.quantity
        await tx.update(rentalItems).set({ quantity: remainingQuantity, totalRent: String(Number(item.monthlyRent) * remainingQuantity), updatedAt: new Date() }).where(and(eq(rentalItems.id, item.id), eq(rentalItems.userId, userId)))
        const [split] = await tx.insert(rentalItems).values({ userId, rentalId, deviceName: item.deviceName, deviceType: item.deviceType, deviceCode: item.deviceCode, deviceConfig: item.deviceConfig, quantity: value.quantity, startDate, endDate: newEndDate, monthlyRent: String(effectiveMonthlyRent), totalRent: String(effectiveMonthlyRent * value.quantity), boughtOutQuantity: 0, buyoutAmount: '0', cpu: item.cpu, motherboard: item.motherboard, memory: item.memory, storage: item.storage, graphicsCard: item.graphicsCard, powerSupply: item.powerSupply, caseModel: item.caseModel, monitorInfo: item.monitorInfo, screenSize: item.screenSize, screenResolution: item.screenResolution, refreshRate: item.refreshRate, panelType: item.panelType, ports: item.ports, batteryInfo: item.batteryInfo, adapterInfo: item.adapterInfo, accessories: item.accessories, colorGamut: item.colorGamut }).returning({ id: rentalItems.id })
        renewedItemId = split.id
      }
      await tx.insert(renewalRecords).values({ userId, rentalId, sourceRentalItemId: item.id, renewedRentalItemId: renewedItemId, quantity: value.quantity, renewalMonths: value.billingUnit === 'month' ? value.duration : null, billingUnit: value.billingUnit, duration: value.duration, unitPrice: String(value.unitPrice), oldMonthlyRent: item.monthlyRent, newMonthlyRent: String(effectiveMonthlyRent), oldEndDate, newEndDate, renewalAmount: String(amount), renewalDate: new Date().toISOString().slice(0, 10), notes: value.notes })
    }
    const allItems = await tx.select().from(rentalItems).where(and(eq(rentalItems.rentalId, rentalId), eq(rentalItems.userId, userId)))
    const active = allItems.filter((item) => item.quantity > item.boughtOutQuantity)
    const quantity = allItems.reduce((sum, item) => sum + item.quantity, 0)
    const monthlyRent = active.reduce((sum, item) => sum + Number(item.monthlyRent), 0)
    const totalRent = allItems.reduce((sum, item) => sum + Number(item.totalRent), 0)
    const endDate = active.map((item) => item.endDate ?? rental.endDate).sort().at(-1) ?? rental.endDate
    const status = rental.status === '逾期' ? '在租' : rental.status
    await tx.update(rentals).set({ quantity, monthlyRent: String(monthlyRent), totalRent: String(totalRent), endDate, status, updatedAt: new Date() }).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId)))
  })
  revalidatePath('/')
}

const paymentSchema = z.object({ amount: z.number().positive(), paymentDate: z.string().min(1), paymentMethod: z.enum(['现金', '微信', '支付宝', '银行卡', '其他']), feeType: z.enum(['原合同租金', '续租费', '押金', '买断费', '其他']), renewalRecordId: z.number().int().positive().optional(), notes: z.string().optional() })
export type PaymentInput = z.infer<typeof paymentSchema>

export async function collectPayment(id: number, input: PaymentInput) {
  const userId = await getUserId()
  const value = paymentSchema.parse(input)
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(rentals).where(and(eq(rentals.id, id), eq(rentals.userId, userId)))
    if (!row) throw new Error('记录不存在')
    if (value.renewalRecordId) {
      const [renewal] = await tx.select().from(renewalRecords).where(and(eq(renewalRecords.id, value.renewalRecordId), eq(renewalRecords.rentalId, id), eq(renewalRecords.userId, userId)))
      if (!renewal) throw new Error('续租记录不存在')
    }
    await tx.insert(paymentRecords).values({ userId, rentalId: id, renewalRecordId: value.renewalRecordId, amount: String(value.amount), paymentDate: value.paymentDate, paymentMethod: value.paymentMethod, feeType: value.feeType, notes: value.notes })
    const paid = Number(row.paidAmount) + value.amount
    await tx.update(rentals).set({ paidAmount: String(paid), paymentStatus: paid >= Number(row.totalRent) ? '已结清' : '部分收款', updatedAt: new Date() }).where(and(eq(rentals.id, id), eq(rentals.userId, userId)))
  })
  revalidatePath('/')
}

export async function buyoutRentalItem(rentalId: number, rentalItemId: number, quantity: number, unitPrice: number, buyoutDate: string, notes = '') {
  const userId = await getUserId()
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('买断数量必须为正整数')
  if (unitPrice <= 0 || !buyoutDate) throw new Error('请填写有效的买断单价和日期')
  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(rentalItems).where(and(eq(rentalItems.id, rentalItemId), eq(rentalItems.rentalId, rentalId), eq(rentalItems.userId, userId)))
    if (!item) throw new Error('设备明细不存在')
    const remaining = item.quantity - item.boughtOutQuantity
    if (quantity > remaining) throw new Error(`最多可买断 ${remaining} 台`)
    const amount = quantity * unitPrice
    await tx.update(rentalItems).set({ boughtOutQuantity: item.boughtOutQuantity + quantity, buyoutAmount: String(Number(item.buyoutAmount) + amount), updatedAt: new Date() }).where(and(eq(rentalItems.id, rentalItemId), eq(rentalItems.userId, userId)))
    await tx.insert(buyoutRecords).values({ userId, rentalId, rentalItemId, quantity, unitPrice: String(unitPrice), amount: String(amount), buyoutDate, notes })
    const allItems = await tx.select().from(rentalItems).where(and(eq(rentalItems.rentalId, rentalId), eq(rentalItems.userId, userId)))
    const bought = allItems.reduce((sum, row) => sum + (row.id === item.id ? item.boughtOutQuantity + quantity : row.boughtOutQuantity), 0)
    const total = allItems.reduce((sum, row) => sum + row.quantity, 0)
    await tx.update(rentals).set({ status: bought >= total ? '买断' : '部分买断', updatedAt: new Date() }).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId)))
  })
  revalidatePath('/')
}

export async function getCustomerHistory(phone: string) {
  const userId = await getUserId()
  const normalized = phone.trim()
  if (!normalized) throw new Error('客户手机号不能为空')
  const contracts = await db.select().from(rentals).where(and(eq(rentals.userId, userId), eq(rentals.customerPhone, normalized))).orderBy(desc(rentals.createdAt))
  const ids = contracts.map((row) => row.id)
  if (!ids.length) return { contracts: [], renewals: [], payments: [], buyouts: [] }
  const [renewals, payments, buyouts] = await Promise.all([
    db.select().from(renewalRecords).where(and(eq(renewalRecords.userId, userId), inArray(renewalRecords.rentalId, ids))).orderBy(desc(renewalRecords.createdAt)),
    db.select().from(paymentRecords).where(and(eq(paymentRecords.userId, userId), inArray(paymentRecords.rentalId, ids))).orderBy(desc(paymentRecords.createdAt)),
    db.select().from(buyoutRecords).where(and(eq(buyoutRecords.userId, userId), inArray(buyoutRecords.rentalId, ids))).orderBy(desc(buyoutRecords.createdAt)),
  ])
  return { contracts, renewals, payments, buyouts }
}

export async function changeStatus(id: number, status: string) {
  const userId = await getUserId()
  if (!['在租', '逾期', '丢失'].includes(status)) throw new Error('无效状态')
  await db.update(rentals).set({ status, updatedAt: new Date() }).where(and(eq(rentals.id, id), eq(rentals.userId, userId)))
  revalidatePath('/')
}
