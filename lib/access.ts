import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { organizationMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

export type ModulePermission = '租赁操作' | '资金查看' | '合同管理' | '账号管理' | '系统设置'

export async function getAccessContext(permission?: ModulePermission) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('未登录')
  const [membership] = await db.select().from(organizationMembers).where(eq(organizationMembers.memberUserId, session.user.id))
  if (!membership) return { userId: session.user.id, actorId: session.user.id, actorName: session.user.name, role: 'admin' as const, permissions: ['租赁操作', '资金查看', '合同管理', '账号管理', '系统设置'] as ModulePermission[] }
  if (!membership.active) throw new Error('账号已停用')
  const permissions = membership.permissions.split(',').filter(Boolean) as ModulePermission[]
  if (permission && !permissions.includes(permission)) throw new Error('没有该模块的操作权限')
  return { userId: membership.ownerId, actorId: session.user.id, actorName: session.user.name, role: 'employee' as const, permissions }
}
