import type { Metadata } from 'next'
import { PortalDashboard, PortalLogin } from '@/components/customer-portal'
import { getCustomerPortalData } from '@/lib/customer-portal'

export const metadata: Metadata = { title: '客户租赁服务中心', description: '安全查看名下租赁设备、账单、维修及退租记录', robots: { index: false, follow: false } }
export default async function CustomerPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await getCustomerPortalData(token)
  if (!data) return <PortalLogin token={token} storeName="租赁" />
  return <PortalDashboard token={token} data={data} />
}
