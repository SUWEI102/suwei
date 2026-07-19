'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { and, count, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { customerPortals, rentals } from '@/lib/db/schema'
import { getAccessContext } from '@/lib/access'
import { createInitialPassword, createPortalToken, hashPortalPassword } from '@/lib/customer-portal'

const normalizePhone = (value: string) => value.replace(/\D/g, '')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export async function getCustomerPortalCustomers() {
  const { userId: ownerId } = await getAccessContext('系统设置')
  const grouped = await db.select({ phone: rentals.customerPhone, customerName: sql<string>`max(${rentals.customerName})`, customerCompany: sql<string | null>`max(${rentals.customerCompany})`, contractCount: count(rentals.id), activeCount: sql<number>`count(*) filter (where ${rentals.status} in ('在租','即将到期','逾期'))` }).from(rentals).where(eq(rentals.userId, ownerId)).groupBy(rentals.customerPhone)
  const portals = await db.select().from(customerPortals).where(eq(customerPortals.userId, ownerId))
  const portalMap = new Map(portals.map((portal) => [portal.phone, portal]))
  return grouped.map((customer) => ({ ...customer, phone: normalizePhone(customer.phone), portal: portalMap.get(normalizePhone(customer.phone)) ?? null }))
}

export async function openCustomerPortal(phone: string, customerName: string) {
  const { userId: ownerId } = await getAccessContext('系统设置')
  const normalizedPhone = normalizePhone(phone)
  if (!/^1\d{10}$/.test(normalizedPhone)) throw new Error('客户手机号格式不正确')
  const existing = await db.select().from(customerPortals).where(and(eq(customerPortals.userId, ownerId), eq(customerPortals.phone, normalizedPhone)))
  if (existing.length) throw new Error('该客户门户已经开通')
  const token = createPortalToken()
  const password = createInitialPassword(normalizedPhone)
  await db.insert(customerPortals).values({ userId: ownerId, phone: normalizedPhone, customerName, accessTokenHash: digest(token), passwordHash: hashPortalPassword(password) })
  revalidatePath('/customer-portals')
  return { token, password }
}

export async function resetCustomerPortal(phone: string) {
  const { userId: ownerId } = await getAccessContext('系统设置')
  const normalizedPhone = normalizePhone(phone)
  const password = createInitialPassword(normalizedPhone)
  const token = createPortalToken()
  const [portal] = await db.select().from(customerPortals).where(and(eq(customerPortals.userId, ownerId), eq(customerPortals.phone, normalizedPhone)))
  if (!portal) throw new Error('客户门户不存在')
  await db.update(customerPortals).set({ accessTokenHash: digest(token), passwordHash: hashPortalPassword(password), sessionVersion: portal.sessionVersion + 1, status: 'active', failedAttempts: 0, lockedUntil: null, updatedAt: new Date() }).where(and(eq(customerPortals.id, portal.id), eq(customerPortals.userId, ownerId)))
  revalidatePath('/customer-portals')
  return { token, password }
}

export async function setCustomerPortalStatus(phone: string, status: 'active' | 'paused') {
  const { userId: ownerId } = await getAccessContext('系统设置')
  await db.update(customerPortals).set({ status, sessionVersion: sql`${customerPortals.sessionVersion} + 1`, updatedAt: new Date() }).where(and(eq(customerPortals.userId, ownerId), eq(customerPortals.phone, normalizePhone(phone))))
  revalidatePath('/customer-portals')
}
