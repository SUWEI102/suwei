'use server'

import { authenticateCustomerPortal, clearPortalSession } from '@/lib/customer-portal'
import { redirect } from 'next/navigation'

export async function loginCustomerPortal(token: string, phone: string, password: string) {
  await authenticateCustomerPortal(token, phone, password)
}

export async function logoutCustomerPortal(token: string) {
  await clearPortalSession()
  redirect(`/portal/${token}`)
}
