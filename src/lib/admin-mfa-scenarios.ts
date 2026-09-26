import type { AdminPermissionKey } from './admin-permissions';

export const ADMIN_MFA_SCENARIO_GROUPS = [
  {
    id: 'finance',
    title: '资金与授信',
    summary: '资金和授信资料修改前即时验证',
    items: [
      { id: 'pricing.write', label: '定价调整', detail: 'pricing.write', permission: 'pricing.write' },
      { id: 'credit.adjust', label: '授信额度与账期', detail: 'credit adjustment' },
      { id: 'finance.write', label: '付款与退款', detail: 'finance.write', permission: 'finance.write' },
    ],
  },
  {
    id: 'orders',
    title: '订单与积分',
    summary: '订单和积分变更前即时验证',
    items: [
      { id: 'orders.write', label: '订单处理', detail: 'orders.write', permission: 'orders.write' },
      { id: 'points.write', label: '积分调整', detail: 'points.write', permission: 'points.write' },
    ],
  },
  {
    id: 'catalog',
    title: '商品资料与库存',
    summary: '商品资料和库存变更前即时验证',
    items: [
      { id: 'products.write', label: '商品资料', detail: 'products.write', permission: 'products.write' },
      { id: 'inventory.write', label: '库存调整', detail: 'inventory.write', permission: 'inventory.write' },
    ],
  },
  {
    id: 'permissions',
    title: '权限管理',
    summary: '角色和成员授权变更前即时验证',
    items: [
      { id: 'roles.manage', label: '管理员角色', detail: 'roles.manage', permission: 'roles.manage' },
      { id: 'organization.permissions', label: '成员权限分配', detail: 'organization permissions' },
    ],
  },
  {
    id: 'general',
    title: '一般管理',
    summary: '普通用户审核默认无需验证',
    items: [
      { id: 'customers.write', label: '注册用户审核', detail: 'customers.write', permission: 'customers.write' },
      { id: 'organizations.write', label: '组织资料管理', detail: 'organizations.write', permission: 'organizations.write' },
    ],
  },
] as const;

export type AdminMfaScenarioId = typeof ADMIN_MFA_SCENARIO_GROUPS[number]['items'][number]['id'];

export type AdminMfaScenarioConfig = Record<AdminMfaScenarioId, boolean>;

export const DEFAULT_ADMIN_MFA_SCENARIOS: AdminMfaScenarioConfig = {
  'pricing.write': true,
  'credit.adjust': true,
  'finance.write': true,
  'orders.write': true,
  'points.write': true,
  'products.write': true,
  'inventory.write': true,
  'roles.manage': true,
  'organization.permissions': true,
  'customers.write': false,
  'organizations.write': false,
};

export const ADMIN_MFA_PERMISSION_SCENARIOS: Partial<Record<AdminPermissionKey, AdminMfaScenarioId>> = {
  'pricing.write': 'pricing.write',
  'finance.write': 'finance.write',
  'orders.write': 'orders.write',
  'points.write': 'points.write',
  'products.write': 'products.write',
  'inventory.write': 'inventory.write',
  'roles.manage': 'roles.manage',
  'customers.write': 'customers.write',
  'organizations.write': 'organizations.write',
};

export function normalizeAdminMfaScenarioConfig(value: unknown): AdminMfaScenarioConfig {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.keys(DEFAULT_ADMIN_MFA_SCENARIOS).reduce((config, id) => {
    config[id as AdminMfaScenarioId] = typeof input[id] === 'boolean'
      ? input[id] as boolean
      : DEFAULT_ADMIN_MFA_SCENARIOS[id as AdminMfaScenarioId];
    return config;
  }, {} as AdminMfaScenarioConfig);
}

export function scenarioConfigToJson(config: AdminMfaScenarioConfig): string {
  return JSON.stringify(normalizeAdminMfaScenarioConfig(config));
}

export function parseAdminMfaScenarioConfig(value: string | null | undefined): AdminMfaScenarioConfig {
  if (!value) return { ...DEFAULT_ADMIN_MFA_SCENARIOS };
  try {
    return normalizeAdminMfaScenarioConfig(JSON.parse(value));
  } catch {
    return { ...DEFAULT_ADMIN_MFA_SCENARIOS };
  }
}
