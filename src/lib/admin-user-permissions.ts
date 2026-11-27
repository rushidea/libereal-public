import { prisma } from './prisma';
import { isAdminEmail } from './auth-helpers';
import { ADMIN_PERMISSION_KEYS, type AdminPermissionKey } from './admin-permissions';

export type AdminPermissionUser = { id: string; email: string; role: string };

export async function getAdminPermissions(user: AdminPermissionUser): Promise<AdminPermissionKey[]> {
  if (user.role !== 'admin') return [];
  if (isAdminEmail(user.email)) return [...ADMIN_PERMISSION_KEYS];

  const assignments = await prisma.adminUserRole.findMany({
    where: { userId: user.id },
    select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } },
  });
  if (assignments.some((assignment) => assignment.role.key === 'super_admin')) return [...ADMIN_PERMISSION_KEYS];

  const keys = new Set(assignments.flatMap((assignment) => assignment.role.permissions.map((item) => item.permission.key)));
  return ADMIN_PERMISSION_KEYS.filter((key) => keys.has(key));
}

