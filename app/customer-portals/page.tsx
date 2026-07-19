import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCustomerPortalCustomers } from '@/app/actions/customer-portals'
import { CustomerPortalAdmin } from '@/components/customer-portal-admin'
import { auth } from '@/lib/auth'

export const metadata: Metadata = { title: '客户门户管理 | 速维租赁管理', description: '管理客户专属二维码和查询门户' }
export default async function CustomerPortalsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  return <CustomerPortalAdmin customers={await getCustomerPortalCustomers()} />
}
