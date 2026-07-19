import { desc, eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { BackupCenter } from '@/components/backup-center'
import { getAccessContext } from '@/lib/access'
import { db } from '@/lib/db'
import { organizationMembers, paymentRecords, rentalItems, rentals } from '@/lib/db/schema'
import packageJson from '@/package.json'
import { getStoreName } from '@/app/actions/business'

export default async function Page() {
  const access = await getAccessContext('系统设置')
  if (access.role !== 'admin') redirect('/')
  const userId = access.userId
  const [[counts], [latest], storeName] = await Promise.all([
    db.select({
      contracts: sql<number>`(select count(*)::int from ${rentals} where ${rentals.userId} = ${userId})`,
      devices: sql<number>`(select count(*)::int from ${rentalItems} where ${rentalItems.userId} = ${userId})`,
      payments: sql<number>`(select count(*)::int from ${paymentRecords} where ${paymentRecords.userId} = ${userId})`,
      members: sql<number>`(select count(*)::int from ${organizationMembers} where ${organizationMembers.ownerId} = ${userId})`,
    }).from(rentals).limit(1),
    db.select({ updatedAt: rentals.updatedAt }).from(rentals).where(eq(rentals.userId, userId)).orderBy(desc(rentals.updatedAt)).limit(1),
    getStoreName(),
  ])
  return <BackupCenter storeName={storeName} version={packageJson.version} counts={counts ?? { contracts: 0, devices: 0, payments: 0, members: 0 }} lastUpdated={latest?.updatedAt?.toISOString() ?? null} />
}
