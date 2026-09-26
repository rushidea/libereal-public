export const ADMIN_PERMISSION_KEYS = [
  'admin.access',
  'products.read', 'products.write',
  'pricing.read', 'pricing.write',
  'inventory.read', 'inventory.write',
  'inquiries.read', 'inquiries.write',
  'orders.read', 'orders.write',
  'customers.read', 'customers.write',
  'organizations.read', 'organizations.write',
  'content.read', 'content.write',
  'points.read', 'points.write',
  'finance.read', 'finance.write',
  'roles.manage', 'audit.read',
  'tasks.read', 'tasks.manage',
] as const;

export type AdminPermissionKey = typeof ADMIN_PERMISSION_KEYS[number];

/**
 * MFA step-up is reserved for financial operations and product or inventory
 * data changes. Routine customer, organization, content, role, and task
 * administration remains protected by the normal admin session and permission
 * checks. Permission assignment remains protected as an access-control
 * operation.
 */
export const ADMIN_MFA_REQUIRED_PERMISSIONS = new Set<AdminPermissionKey>([
  'products.write',
  'pricing.write',
  'inventory.write',
  'orders.write',
  'points.write',
  'finance.write',
  'roles.manage',
]);

export function requiresAdminMfa(permission?: AdminPermissionKey): boolean {
  return permission ? ADMIN_MFA_REQUIRED_PERMISSIONS.has(permission) : false;
}

export const ADMIN_ROLE_DEFINITIONS = {
  super_admin: {
    name: '超级管理员',
    description: '全部管理能力',
    permissions: ADMIN_PERMISSION_KEYS,
  },
  product_admin: {
    name: '商品管理员',
    description: '商品、分类、价格、资料和库存',
    permissions: ['admin.access', 'products.read', 'products.write', 'pricing.read', 'pricing.write', 'inventory.read', 'inventory.write'],
  },
  order_admin: {
    name: '订单管理员',
    description: '询价、报价、订单和发货',
    permissions: ['admin.access', 'inquiries.read', 'inquiries.write', 'orders.read', 'orders.write', 'customers.read', 'products.read', 'pricing.read', 'inventory.read', 'inventory.write', 'tasks.read'],
  },
  customer_admin: {
    name: '客户管理员',
    description: '用户审核、等级、积分和账户限制',
    permissions: ['admin.access', 'customers.read', 'customers.write', 'points.read', 'points.write'],
  },
  content_admin: {
    name: '内容管理员',
    description: '实验方法、场景、公告和活动',
    permissions: ['admin.access', 'content.read', 'content.write'],
  },
  finance_staff: {
    name: '财务人员',
    description: '成交价、付款、退款和报表',
    permissions: ['admin.access', 'finance.read', 'finance.write', 'pricing.read', 'pricing.write', 'orders.read', 'customers.read', 'points.read', 'audit.read', 'tasks.read'],
  },
} as const satisfies Record<string, { name: string; description: string; permissions: readonly AdminPermissionKey[] }>;

export type AdminRoleKey = keyof typeof ADMIN_ROLE_DEFINITIONS;

export function hasAdminPermission(permissions: readonly string[], permission: AdminPermissionKey): boolean {
  return permissions.includes(permission);
}
