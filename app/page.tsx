import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getDashboard, getRentals } from '@/app/actions/rentals'
import { Dashboard } from '@/components/dashboard'
import { getAccessContext } from '@/lib/access'
import { getStoreName } from '@/app/actions/business'

export default async function Page(){ const session=await auth.api.getSession({headers:await headers()}); if(!session?.user) redirect('/sign-in'); const [summary,rentals,access,storeName]=await Promise.all([getDashboard(),getRentals(),getAccessContext('租赁操作'),getStoreName()]); return <Dashboard storeName={storeName} userName={session.user.name} role={access.role} permissions={access.permissions} summary={summary} rentals={rentals}/> }
