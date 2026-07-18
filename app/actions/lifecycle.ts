'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAccessContext } from '@/lib/access'
import { db } from '@/lib/db'
import { accountLedger, paymentAllocations, paymentRecords, receivableBills, rentalEvents, rentalItems, rentals } from '@/lib/db/schema'

async function actor() { const context = await getAccessContext('租赁操作'); return { userId: context.userId, name: context.actorName } }
const base = z.object({ rentalId:z.number().int().positive(), itemId:z.number().int().positive().optional(), eventDate:z.string().min(1), reason:z.string().optional(), notes:z.string().optional() })
export type LifecycleInput = z.infer<typeof base> & { eventType:'押金处理'|'设备换机'|'配置/租金变更'|'维修登记'; amount?:number; deviceName?:string; deviceCode?:string; deviceConfig?:string; monthlyRent?:number; faultDescription?:string; resolution?:string }

export async function generateBills(rentalId:number) {
  const { userId } = await actor()
  await db.transaction(async tx => {
    const [rental] = await tx.select().from(rentals).where(and(eq(rentals.id,rentalId),eq(rentals.userId,userId)))
    if(!rental) throw new Error('合同不存在')
    const items = await tx.select().from(rentalItems).where(and(eq(rentalItems.rentalId,rentalId),eq(rentalItems.userId,userId)))
    let cursor = rental.startDate; let index=1
    while(cursor <= rental.endDate){
      const start=new Date(`${cursor}T00:00:00Z`); const end=new Date(start); end.setUTCMonth(end.getUTCMonth()+1); end.setUTCDate(end.getUTCDate()-1)
      const periodEnd=end.toISOString().slice(0,10)>rental.endDate?rental.endDate:end.toISOString().slice(0,10)
      const amount=items.reduce((sum,item)=>sum+Number(item.monthlyRent)*Math.max(0,item.quantity-item.boughtOutQuantity-item.returnedQuantity-item.lostQuantity),0)
      const billNo=`${rental.contractNo}-${String(index).padStart(3,'0')}`
      await tx.insert(receivableBills).values({userId,rentalId,billNo,periodStart:cursor,periodEnd,dueDate:cursor,billType:'租金',amount:String(amount),paidAmount:'0',status:'待收'}).onConflictDoNothing()
      const next=new Date(start);next.setUTCMonth(next.getUTCMonth()+1);cursor=next.toISOString().slice(0,10);index++
    }
    if(Number(rental.deposit)>0) await tx.insert(receivableBills).values({userId,rentalId,billNo:`${rental.contractNo}-DEPOSIT`,periodStart:rental.startDate,periodEnd:rental.startDate,dueDate:rental.startDate,billType:'押金',amount:rental.deposit,paidAmount:'0',status:'待收'}).onConflictDoNothing()
  })
  revalidatePath('/')
}

export async function collectBillPayment(rentalId:number, amount:number, paymentDate:string, paymentMethod:string, notes='') {
  const {userId,name}=await actor(); if(amount<=0) throw new Error('收款金额必须大于 0')
  await db.transaction(async tx=>{
    const [rental]=await tx.select().from(rentals).where(and(eq(rentals.id,rentalId),eq(rentals.userId,userId))); if(!rental) throw new Error('合同不存在')
    const [payment]=await tx.insert(paymentRecords).values({userId,rentalId,amount:String(amount),paymentDate,paymentMethod,feeType:'账单收款',notes,operatorName:name}).returning({id:paymentRecords.id})
    const bills=await tx.select().from(receivableBills).where(and(eq(receivableBills.userId,userId),eq(receivableBills.rentalId,rentalId))).orderBy(asc(receivableBills.dueDate)); let remaining=amount
    for(const bill of bills){if(remaining<=0)break;const due=Number(bill.amount)-Number(bill.paidAmount);if(due<=0)continue;const applied=Math.min(due,remaining);const paid=Number(bill.paidAmount)+applied;await tx.insert(paymentAllocations).values({userId,paymentRecordId:payment.id,receivableBillId:bill.id,amount:String(applied)});await tx.update(receivableBills).set({paidAmount:String(paid),status:paid>=Number(bill.amount)?'已收':'部分收款',updatedAt:new Date()}).where(and(eq(receivableBills.id,bill.id),eq(receivableBills.userId,userId)));remaining-=applied}
    await tx.insert(accountLedger).values({userId,rentalId,entryType:'收款',amount:String(amount),entryDate:paymentDate,paymentRecordId:payment.id,operatorName:name,notes})
    const paid=Number(rental.paidAmount)+amount;await tx.update(rentals).set({paidAmount:String(paid),paymentStatus:paid>=Number(rental.totalRent)?'已结清':'部分收款',updatedAt:new Date()}).where(and(eq(rentals.id,rentalId),eq(rentals.userId,userId)))
  });revalidatePath('/');revalidatePath('/finance')
}

export async function recordLifecycle(input:LifecycleInput){
  const {userId,name}=await actor();const value=base.extend({eventType:z.enum(['押金处理','设备换机','配置/租金变更','维修登记']),amount:z.number().optional(),deviceName:z.string().optional(),deviceCode:z.string().optional(),deviceConfig:z.string().optional(),monthlyRent:z.number().optional(),faultDescription:z.string().optional(),resolution:z.string().optional()}).parse(input)
  await db.transaction(async tx=>{
    const [rental]=await tx.select().from(rentals).where(and(eq(rentals.id,value.rentalId),eq(rentals.userId,userId)));if(!rental)throw new Error('合同不存在')
    let before:string|undefined;let after:string|undefined
    if(value.itemId){const [item]=await tx.select().from(rentalItems).where(and(eq(rentalItems.id,value.itemId),eq(rentalItems.userId,userId),eq(rentalItems.rentalId,value.rentalId)));if(!item)throw new Error('设备不存在');before=JSON.stringify(item);const patch:Record<string,unknown>={updatedAt:new Date()};if(value.deviceName)patch.deviceName=value.deviceName;if(value.deviceCode!==undefined)patch.deviceCode=value.deviceCode;if(value.deviceConfig!==undefined)patch.deviceConfig=value.deviceConfig;if(value.monthlyRent!==undefined)patch.monthlyRent=String(value.monthlyRent);await tx.update(rentalItems).set(patch).where(and(eq(rentalItems.id,item.id),eq(rentalItems.userId,userId)));after=JSON.stringify({...item,...patch})}
    await tx.insert(rentalEvents).values({userId,rentalId:value.rentalId,itemId:value.itemId,eventType:value.eventType,eventDate:value.eventDate,beforeSnapshot:before,afterSnapshot:after,reason:value.reason,feeAdjustment:String(value.amount||0),repairCost:value.eventType==='维修登记'?String(value.amount||0):'0',faultDescription:value.faultDescription,resolution:value.resolution,operatorName:name,notes:value.notes})
    if(value.amount){const type=value.eventType==='押金处理'?(value.amount<0?'押金退还':'押金收取'):value.eventType;await tx.insert(accountLedger).values({userId,rentalId:value.rentalId,entryType:type,amount:String(value.amount),entryDate:value.eventDate,operatorName:name,notes:value.notes})}
  });revalidatePath('/');revalidatePath('/finance')
}

export async function getContractLifecycle(rentalId:number){const {userId}=await actor();const [bills,events,ledger]=await Promise.all([db.select().from(receivableBills).where(and(eq(receivableBills.userId,userId),eq(receivableBills.rentalId,rentalId))).orderBy(asc(receivableBills.dueDate)),db.select().from(rentalEvents).where(and(eq(rentalEvents.userId,userId),eq(rentalEvents.rentalId,rentalId))).orderBy(asc(rentalEvents.eventDate)),db.select().from(accountLedger).where(and(eq(accountLedger.userId,userId),eq(accountLedger.rentalId,rentalId))).orderBy(asc(accountLedger.entryDate))]);return{bills,events,ledger}}
