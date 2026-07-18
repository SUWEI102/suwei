import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accountLedger, businessSettings, buyoutRecords, customerPortals, paymentRecords, receivableBills, renewalRecords, rentalEvents, rentalItems, rentals, returnRecords } from '@/lib/db/schema'

const COOKIE = 'customer_portal_session'
const normalizePhone = (value: string) => value.replace(/\D/g, '')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const maskPhone = (phone: string) => phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '****'
export function hashPortalPassword(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }
function verifyPortalPassword(password: string, stored: string) { const [salt, hash] = stored.split(':'); if (!salt || !hash) return false; const expected = Buffer.from(hash, 'hex'); const actual = scryptSync(password, salt, 64); return expected.length === actual.length && timingSafeEqual(expected, actual) }
export function createPortalToken() { return randomBytes(24).toString('base64url') }
export function createInitialPassword(phone: string) {
  const normalized = normalizePhone(phone)
  if (normalized.length < 6) throw new Error('客户手机号格式不正确')
  return normalized.slice(-6)
}

export async function setPortalSession(portalId: number, version: number) {
  const expiresAt = Date.now() + 7 * 86400000
  const payload = `${portalId}.${version}.${expiresAt}`
  const signature = digest(`${payload}.${process.env.BETTER_AUTH_SECRET}`)
  ;(await cookies()).set(COOKIE, `${payload}.${signature}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400, path: '/' })
}
export async function clearPortalSession() { (await cookies()).delete(COOKIE) }
async function sessionPortal() {
  const value = (await cookies()).get(COOKIE)?.value
  if (!value) return null
  const [id, version, expires, signature] = value.split('.')
  const payload = `${id}.${version}.${expires}`
  if (!signature || digest(`${payload}.${process.env.BETTER_AUTH_SECRET}`) !== signature || Number(expires) < Date.now()) return null
  const [portal] = await db.select().from(customerPortals).where(and(eq(customerPortals.id, Number(id)), eq(customerPortals.status, 'active')))
  if (!portal || portal.sessionVersion !== Number(version)) return null
  return portal
}

export async function authenticateCustomerPortal(token: string, phone: string, password: string) {
  const tokenHash = digest(token)
  const normalizedPhone = normalizePhone(phone)
  const [portal] = await db.select().from(customerPortals).where(eq(customerPortals.accessTokenHash, tokenHash))
  if (!portal || portal.phone !== normalizedPhone || portal.status !== 'active') throw new Error('手机号或专属密码不正确')
  if (portal.lockedUntil && portal.lockedUntil > new Date()) throw new Error('尝试次数过多，请稍后再试')
  if (!verifyPortalPassword(password, portal.passwordHash)) {
    const attempts = portal.failedAttempts + 1
    await db.update(customerPortals).set({ failedAttempts: attempts >= 5 ? 0 : attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null, updatedAt: new Date() }).where(and(eq(customerPortals.id, portal.id), eq(customerPortals.userId, portal.userId)))
    throw new Error('手机号或专属密码不正确')
  }
  await db.update(customerPortals).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() }).where(and(eq(customerPortals.id, portal.id), eq(customerPortals.userId, portal.userId)))
  await setPortalSession(portal.id, portal.sessionVersion)
}

export async function getCustomerPortalData(token: string) {
  const portal = await sessionPortal()
  if (!portal || portal.accessTokenHash !== digest(token)) return null
  const contracts = await db.select().from(rentals).where(and(eq(rentals.userId, portal.userId), eq(rentals.customerPhone, portal.phone)))
  const ids = contracts.map((contract) => contract.id)
  const empty = { items: [], bills: [], payments: [], ledger: [], renewals: [], buyouts: [], returns: [], events: [] }
  if (!ids.length) return { portal, settings: null, contracts: [], ...empty }
  const [items, bills, payments, ledger, renewals, buyouts, returns, events, [settings]] = await Promise.all([
    db.select().from(rentalItems).where(and(eq(rentalItems.userId, portal.userId), inArray(rentalItems.rentalId, ids))),
    db.select().from(receivableBills).where(and(eq(receivableBills.userId, portal.userId), inArray(receivableBills.rentalId, ids))),
    db.select().from(paymentRecords).where(and(eq(paymentRecords.userId, portal.userId), inArray(paymentRecords.rentalId, ids))),
    db.select().from(accountLedger).where(and(eq(accountLedger.userId, portal.userId), inArray(accountLedger.rentalId, ids))),
    db.select().from(renewalRecords).where(and(eq(renewalRecords.userId, portal.userId), inArray(renewalRecords.rentalId, ids))),
    db.select().from(buyoutRecords).where(and(eq(buyoutRecords.userId, portal.userId), inArray(buyoutRecords.rentalId, ids))),
    db.select().from(returnRecords).where(and(eq(returnRecords.userId, portal.userId), inArray(returnRecords.rentalId, ids))),
    db.select().from(rentalEvents).where(and(eq(rentalEvents.userId, portal.userId), inArray(rentalEvents.rentalId, ids))),
    db.select().from(businessSettings).where(eq(businessSettings.userId, portal.userId)),
  ])
  return { portal, settings, contracts, items, bills, payments, ledger, renewals, buyouts, returns, events }
}
