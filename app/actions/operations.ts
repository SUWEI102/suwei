'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAccessContext } from '@/lib/access'
import { db } from '@/lib/db'
import { accountLedger, lossRecords, receivableBills, rentalEvents, rentalItems, rentals, returnRecords } from '@/lib/db/schema'

async function actor() {
  const context = await getAccessContext('租赁操作')
  return { userId: context.userId, name: context.actorName }
}

const operationSchema = z.object({ rentalId: z.number().int().positive(), rentalItemId: z.number().int().positive(), quantity: z.number().int().positive(), date: z.string().min(1), notes: z.string().optional() })
export type ReturnInput = z.infer<typeof operationSchema> & { condition: '完好'|'轻微磨损'|'损坏'; deductionAmount: number; depositRefund: number }
export type LossInput = z.infer<typeof operationSchema> & { unitCompensation: number }

async function updateRentalStatus(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string, rentalId: number) {
  const items = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId, userId), eq(rentalItems.rentalId, rentalId)))
  const total = items.reduce((s, i) => s + i.quantity, 0)
  const returned = items.reduce((s, i) => s + i.returnedQuantity, 0)
  const lost = items.reduce((s, i) => s + i.lostQuantity, 0)
  const bought = items.reduce((s, i) => s + i.boughtOutQuantity, 0)
  const handled = returned + lost + bought
  const status = handled >= total ? (lost ? '已结束' : bought === total ? '买断' : '已退租') : returned ? '部分退租' : lost ? '部分丢失' : bought ? '部分买断' : '在租'
  await tx.update(rentals).set({ status, updatedAt: new Date() }).where(and(eq(rentals.userId, userId), eq(rentals.id, rentalId)))
}

export async function returnRentalItem(input: ReturnInput) {
  const { userId, name } = await actor()
  const value = operationSchema.extend({ condition: z.enum(['完好','轻微磨损','损坏']), deductionAmount: z.number().nonnegative(), depositRefund: z.number().nonnegative() }).parse(input)
  await db.transaction(async tx => {
    const [item] = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId,userId),eq(rentalItems.rentalId,value.rentalId),eq(rentalItems.id,value.rentalItemId)))
    if (!item) throw new Error('设备不存在')
    const available = item.quantity-item.boughtOutQuantity-item.returnedQuantity-item.lostQuantity
    if (value.quantity>available) throw new Error(`最多可退 ${available} 台`)
    await tx.update(rentalItems).set({returnedQuantity:item.returnedQuantity+value.quantity,updatedAt:new Date()}).where(and(eq(rentalItems.userId,userId),eq(rentalItems.id,item.id)))
    await tx.insert(returnRecords).values({userId,rentalId:value.rentalId,rentalItemId:value.rentalItemId,quantity:value.quantity,returnDate:value.date,condition:value.condition,deductionAmount:String(value.deductionAmount),depositRefund:String(value.depositRefund),notes:value.notes,operatorName:name})
    const itemEndDate = item.endDate
    if (itemEndDate && value.date < itemEndDate) {
      const unusedDays = Math.max(0, Math.ceil((new Date(`${itemEndDate}T00:00:00Z`).getTime() - new Date(`${value.date}T00:00:00Z`).getTime()) / 86400000))
      const reduction = Math.round((Number(item.monthlyRent) / 30) * unusedDays * value.quantity * 100) / 100
      if (reduction > 0) await tx.insert(receivableBills).values({ userId, rentalId: value.rentalId, billNo: `RETURN-${value.rentalId}-${Date.now()}`, periodStart: value.date, periodEnd: value.date, dueDate: value.date, billType: '提前退租减免', amount: String(-reduction), paidAmount: '0', status: '已调整', notes: `提前 ${unusedDays} 天退租，按实际使用天数结算` })
    }
    if (value.deductionAmount > 0) await tx.insert(accountLedger).values({ userId, rentalId: value.rentalId, entryType: '押金抵扣赔偿', amount: String(-value.deductionAmount), entryDate: value.date, operatorName: name, notes: value.notes })
    if (value.depositRefund > 0) await tx.insert(accountLedger).values({ userId, rentalId: value.rentalId, entryType: '押金退还', amount: String(-value.depositRefund), entryDate: value.date, operatorName: name, notes: value.notes })
    await updateRentalStatus(tx,userId,value.rentalId)
  })
  revalidatePath('/')
}

const exchangeText = z.string().trim().max(500).optional()
const exchangeSchema = z.object({
  rentalId: z.number().int().positive(), rentalItemId: z.number().int().positive(), exchangeDate: z.string().min(1), newDeviceName: z.string().trim().min(2), newDeviceType: z.enum(['台式机','笔记本','显示器','一体机','其他']), newDeviceCode: z.string().trim().min(1), newDeviceConfig: exchangeText,
  cpu:exchangeText,motherboard:exchangeText,memory:exchangeText,storage:exchangeText,graphicsCard:exchangeText,powerSupply:exchangeText,caseModel:exchangeText,monitorInfo:exchangeText,screenSize:exchangeText,screenResolution:exchangeText,refreshRate:exchangeText,panelType:exchangeText,ports:exchangeText,batteryInfo:exchangeText,adapterInfo:exchangeText,accessories:exchangeText,colorGamut:exchangeText,
  reason: z.string().trim().min(2), notes: exchangeText,
})
export type ExchangeInput = z.infer<typeof exchangeSchema>

export async function exchangeRentalItem(input: ExchangeInput) {
  const { userId, name } = await actor()
  const value = exchangeSchema.parse(input)
  await db.transaction(async tx => {
    const [item] = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId, userId), eq(rentalItems.rentalId, value.rentalId), eq(rentalItems.id, value.rentalItemId)))
    if (!item) throw new Error('设备不存在')
    const keys = ['deviceName','deviceType','deviceCode','deviceConfig','cpu','motherboard','memory','storage','graphicsCard','powerSupply','caseModel','monitorInfo','screenSize','screenResolution','refreshRate','panelType','ports','batteryInfo','adapterInfo','accessories','colorGamut'] as const
    const before = Object.fromEntries(keys.map(key => [key, item[key]]))
    const after = { deviceName:value.newDeviceName,deviceType:value.newDeviceType,deviceCode:value.newDeviceCode,deviceConfig:value.newDeviceConfig||null,cpu:value.cpu||null,motherboard:value.motherboard||null,memory:value.memory||null,storage:value.storage||null,graphicsCard:value.graphicsCard||null,powerSupply:value.powerSupply||null,caseModel:value.caseModel||null,monitorInfo:value.monitorInfo||null,screenSize:value.screenSize||null,screenResolution:value.screenResolution||null,refreshRate:value.refreshRate||null,panelType:value.panelType||null,ports:value.ports||null,batteryInfo:value.batteryInfo||null,adapterInfo:value.adapterInfo||null,accessories:value.accessories||null,colorGamut:value.colorGamut||null }
    await tx.update(rentalItems).set({ ...after, updatedAt: new Date() }).where(and(eq(rentalItems.userId, userId), eq(rentalItems.id, item.id)))
    const items = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId,userId),eq(rentalItems.rentalId,value.rentalId)))
    await tx.update(rentals).set({deviceName:items.map(current=>current.deviceName).join('、'),deviceType:items.length===1?items[0].deviceType:'多设备',updatedAt:new Date()}).where(and(eq(rentals.userId,userId),eq(rentals.id,value.rentalId)))
    await tx.insert(rentalEvents).values({ userId, rentalId: value.rentalId, eventType: '换机调拨', status: '已完成', eventDate: value.exchangeDate, itemId: item.id, beforeSnapshot: before, afterSnapshot: after, reason: value.reason, operatorName: name, notes: value.notes })
  })
  revalidatePath('/')
}

export async function reportLostItem(input: LossInput) {
  const { userId, name } = await actor()
  const value = operationSchema.extend({ unitCompensation: z.number().positive() }).parse(input)
  await db.transaction(async tx => {
    const [item] = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId,userId),eq(rentalItems.rentalId,value.rentalId),eq(rentalItems.id,value.rentalItemId)))
    if (!item) throw new Error('设备不存在')
    const available = item.quantity-item.boughtOutQuantity-item.returnedQuantity-item.lostQuantity
    if (value.quantity>available) throw new Error(`最多可登记丢失 ${available} 台`)
    await tx.update(rentalItems).set({lostQuantity:item.lostQuantity+value.quantity,updatedAt:new Date()}).where(and(eq(rentalItems.userId,userId),eq(rentalItems.id,item.id)))
    await tx.insert(lossRecords).values({userId,rentalId:value.rentalId,rentalItemId:value.rentalItemId,quantity:value.quantity,lossDate:value.date,unitCompensation:String(value.unitCompensation),amount:String(value.unitCompensation*value.quantity),notes:value.notes,operatorName:name})
    await updateRentalStatus(tx,userId,value.rentalId)
  })
  revalidatePath('/')
}
