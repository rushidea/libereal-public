export const ADMIN_USER_DELETE_BATCH_LIMIT = 500;

const MAX_USER_ID_LENGTH = 128;

export const ADMIN_USER_DELETE_ERRORS = {
  empty: '请选择要停用的用户',
  tooMany: `一次最多停用 ${ADMIN_USER_DELETE_BATCH_LIMIT} 个用户`,
  invalidId: '用户标识无效',
  missing: '未找到目标用户',
  admin: '不能停用管理员账户',
  self: '不能停用当前登录账号',
  owner: '不能停用组织负责人，请先移交组织',
  failed: '停用失败，请稍后重试。',
} as const;

export type AdminUserDeleteTarget = {
  id: string;
  role: string;
};

export function parseAdminUserDeleteIds(value: unknown): { ids: string[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: ADMIN_USER_DELETE_ERRORS.empty };
  }
  if (value.length > ADMIN_USER_DELETE_BATCH_LIMIT) {
    return { error: ADMIN_USER_DELETE_ERRORS.tooMany };
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return { error: ADMIN_USER_DELETE_ERRORS.invalidId };
    const id = item.trim();
    if (!id || id.length > MAX_USER_ID_LENGTH) return { error: ADMIN_USER_DELETE_ERRORS.invalidId };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (ids.length === 0) return { error: ADMIN_USER_DELETE_ERRORS.empty };
  return { ids };
}

/**
 * 整批拒绝，避免只停用其中一部分客户、留下管理员或负责人。
 * 管理员优先于“当前账号”，因为后台操作者本身也是管理员。
 */
export function adminUserDeleteBlockMessage(
  targets: AdminUserDeleteTarget[],
  actorId: string,
  organizationOwnerIds: Iterable<string>,
): string | null {
  if (targets.some((item) => item.role === 'admin')) return ADMIN_USER_DELETE_ERRORS.admin;
  if (targets.some((item) => item.id === actorId)) return ADMIN_USER_DELETE_ERRORS.self;
  const owners = organizationOwnerIds instanceof Set
    ? organizationOwnerIds
    : new Set(organizationOwnerIds);
  if (targets.some((item) => owners.has(item.id))) return ADMIN_USER_DELETE_ERRORS.owner;
  return null;
}
