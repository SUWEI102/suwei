'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAccessContext } from '@/lib/access'
import { db } from '@/lib/db'
import { rentalEvents, rentalItems, rentals } from '@/lib/db/schema'

async function actor() {
  const context = await getAccessContext('租赁操作')
  return { userId: context.userId, name: context.actorName }
}

const optionalText = z.string().trim().max(500).optional()
const deviceTypeSchema = z.enum(['台式机','笔记本','显示器','一体机','其他'])
const configurationSchema = {
  deviceConfig: optionalText, cpu: optionalText, motherboard: optionalText, memory: optionalText, storage: optionalText, graphicsCard: optionalText, powerSupply: optionalText, caseModel: optionalText, monitorInfo: optionalText,
  screenSize: optionalText, screenResolution: optionalText, refreshRate: optionalText, panelType: optionalText, ports: optionalText, batteryInfo: optionalText, adapterInfo: optionalText, accessories: optionalText, colorGamut: optionalText,
}
const changeSchema = z.object({
  rentalId: z.number().int().positive(), itemId: z.number().int().positive(), eventDate: z.string().min(1), reason: z.string().trim().min(2),
  deviceName: z.string().trim().min(2), deviceType: deviceTypeSchema, deviceCode: optionalText, quantity: z.coerce.number().int().positive(), ...configurationSchema,
  monthlyRent: z.coerce.number().positive('租金单价必须大于 0'), totalRent: z.coerce.number().positive(), feeAdjustment: z.coerce.number(), notes: optionalText,
})
export type RentalChangeInput = z.infer<typeof changeSchema>

const repairSchema = z.object({ rentalId: z.number().int().positive(), itemId: z.number().int().positive(), eventDate: z.string().min(1), status: z.enum(['待维修','维修中','已完成']), faultDescription: z.string().trim().min(2), resolution: optionalText, repairCost: z.coerce.number().nonnegative(), customerCharge: z.coerce.number().nonnegative(), completedDate: z.string().optional(), notes: optionalText })
export type RepairInput = z.infer<typeof repairSchema>

const snapshotKeys = ['deviceName','deviceType','deviceCode','deviceConfig','quantity','monthlyRent','totalRent','cpu','motherboard','memory','storage','graphicsCard','powerSupply','caseModel','monitorInfo','screenSize','screenResolution','refreshRate','panelType','ports','batteryInfo','adapterInfo','accessories','colorGamut'] as const
function snapshot(item: Record<string, unknown>) { return Object.fromEntries(snapshotKeys.map(key => [key, item[key]])) }

export async function changeRentalItem(input: RentalChangeInput) {
  const { userId, name } = await actor()
  const value = changeSchema.parse(input)
  await db.transaction(async tx => {
    const [item] = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId,userId),eq(rentalItems.rentalId,value.rentalId),eq(rentalItems.id,value.itemId)))
    if (!item) throw new Error('设备明细不存在')
    if (value.quantity < item.quantity) throw new Error('配置变更不能减少数量，请使用退租、丢失或买断流程')
    const after = { ...snapshot(item), deviceName:value.deviceName, deviceType:value.deviceType, deviceCode:value.deviceCode||null, quantity:value.quantity, deviceConfig:value.deviceConfig||null, cpu:value.cpu||null, motherboard:value.motherboard||null, memory:value.memory||null, storage:value.storage||null, graphicsCard:value.graphicsCard||null, powerSupply:value.powerSupply||null, caseModel:value.caseModel||null, monitorInfo:value.monitorInfo||null, screenSize:value.screenSize||null, screenResolution:value.screenResolution||null, refreshRate:value.refreshRate||null, panelType:value.panelType||null, ports:value.ports||null, batteryInfo:value.batteryInfo||null, adapterInfo:value.adapterInfo||null, accessories:value.accessories||null, colorGamut:value.colorGamut||null, monthlyRent:String(value.monthlyRent), totalRent:String(value.totalRent) }
    await tx.update(rentalItems).set({ ...after, updatedAt:new Date() }).where(and(eq(rentalItems.userId,userId),eq(rentalItems.id,item.id)))
    const [rental] = await tx.select().from(rentals).where(and(eq(rentals.userId,userId),eq(rentals.id,value.rentalId)))
    if (!rental) throw new Error('租赁合同不存在')
    const items = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId,userId),eq(rentalItems.rentalId,value.rentalId)))
    const quantity = items.reduce((sum,current)=>sum+current.quantity,0)
    const monthlyRent = items.reduce((sum,current)=>sum+Number(current.monthlyRent)*current.quantity,0)
    const previousItemTotal = Number(item.totalRent)
    const totalRent = Number(rental.totalRent)-previousItemTotal+value.totalRent+value.feeAdjustment
    const paymentStatus = Number(rental.paidAmount)>=totalRent?'已结清':Number(rental.paidAmount)>0?'部分收款':'待收款'
    await tx.update(rentals).set({ deviceName:items.map(current=>current.deviceName).join('、'),deviceType:items.length===1?items[0].deviceType:'多设备',quantity,monthlyRent:String(monthlyRent),totalRent:String(totalRent),paymentStatus,updatedAt:new Date() }).where(and(eq(rentals.userId,userId),eq(rentals.id,value.rentalId)))
    await tx.insert(rentalEvents).values({userId,rentalId:value.rentalId,itemId:value.itemId,eventType:'配置变更',eventDate:value.eventDate,beforeSnapshot:snapshot(item),afterSnapshot:after,reason:value.reason,feeAdjustment:String(value.feeAdjustment),operatorName:name,notes:value.notes})
  })
  revalidatePath('/')
}

export async function createRepairRecord(input: RepairInput) {
  const { userId, name } = await actor()
  const value = repairSchema.parse(input)
  await db.transaction(async tx => {
    const [item] = await tx.select().from(rentalItems).where(and(eq(rentalItems.userId,userId),eq(rentalItems.rentalId,value.rentalId),eq(rentalItems.id,value.itemId)))
    if (!item) throw new Error('设备明细不存在')
    const [rental] = await tx.select().from(rentals).where(and(eq(rentals.userId,userId),eq(rentals.id,value.rentalId)))
    if (!rental) throw new Error('租赁合同不存在')
    const totalRent = Number(rental.totalRent)+value.customerCharge
    const paymentStatus = Number(rental.paidAmount)>=totalRent?'已结清':Number(rental.paidAmount)>0?'部分收款':'待收款'
    await tx.update(rentals).set({totalRent:String(totalRent),paymentStatus,updatedAt:new Date()}).where(and(eq(rentals.userId,userId),eq(rentals.id,value.rentalId)))
    await tx.insert(rentalEvents).values({userId,rentalId:value.rentalId,itemId:value.itemId,eventType:'维修',status:value.status,eventDate:value.eventDate,beforeSnapshot:snapshot(item),faultDescription:value.faultDescription,resolution:value.resolution,repairCost:String(value.repairCost),customerCharge:String(value.customerCharge),completedDate:value.completedDate||null,operatorName:name,notes:value.notes})
  })
  revalidatePath('/')
}

export async function getRentalEvents(rentalId:number) {
  const { userId } = await actor()
  return db.select().from(rentalEvents).where(and(eq(rentalEvents.userId,userId),eq(rentalEvents.rentalId,rentalId))).orderBy(desc(rentalEvents.eventDate),desc(rentalEvents.createdAt))
}
