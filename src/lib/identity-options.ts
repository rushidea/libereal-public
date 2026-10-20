/** 客户可在账户设置中自选一次的身份。 */
export const CUSTOMER_IDENTITY_OPTIONS = [
  '教授',
  '研究员',
  '学生',
  '博士研究生',
  '硕士研究生',
  'PI',
  '博士后',
  '技术员',
  '行政',
  '医师',
] as const;

/** 仅后台可设置。客户看不到，也不能选。 */
export const INTERNAL_IDENTITY_OPTIONS = [
  '内部员工',
  '测试账号',
  '代客下单账户',
  '渠道/经销商',
] as const;

/** 这三种身份需要填写导师字段。 */
export const ADVISOR_REQUIRED_IDENTITIES = [
  '学生',
  '博士研究生',
  '硕士研究生',
] as const;

export type CustomerIdentityOption = typeof CUSTOMER_IDENTITY_OPTIONS[number];
export type InternalIdentityOption = typeof INTERNAL_IDENTITY_OPTIONS[number];

const customerIdentitySet = new Set<string>(CUSTOMER_IDENTITY_OPTIONS);
const internalIdentitySet = new Set<string>(INTERNAL_IDENTITY_OPTIONS);
const advisorRequiredIdentitySet = new Set<string>(ADVISOR_REQUIRED_IDENTITIES);

export function normalizeIdentityText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isCustomerIdentityOption(value: string | null | undefined): boolean {
  return customerIdentitySet.has(normalizeIdentityText(value));
}

export function isInternalIdentityOption(value: string | null | undefined): boolean {
  return internalIdentitySet.has(normalizeIdentityText(value));
}

export function isAssignableIdentity(value: string | null | undefined): boolean {
  const text = normalizeIdentityText(value);
  return customerIdentitySet.has(text) || internalIdentitySet.has(text);
}

/**
 * 身份为空，或不在客户可选列表里（内部角色不算）时，客户可以自选一次。
 * 已经是客户可选值或内部角色时锁定。
 */
export function customerCanChooseIdentity(current: string | null | undefined): boolean {
  const text = normalizeIdentityText(current);
  if (!text) return true;
  if (customerIdentitySet.has(text) || internalIdentitySet.has(text)) return false;
  return true;
}

export function parseCustomerIdentityChoice(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return customerIdentitySet.has(text) ? text : null;
}

export function identityRequiresAdvisor(value: string | null | undefined): boolean {
  return advisorRequiredIdentitySet.has(normalizeIdentityText(value));
}

export type AdminIdentityUpdate =
  | { ok: true; identity: string | null }
  | { ok: false };

/**
 * 后台可写入客户身份、内部角色，或清空。
 * 与当前值完全相同的历史自由文本允许原样保存，避免改其他资料时被拦住；不能改成另一个列表外的值。
 */
export function normalizeAdminIdentity(next: unknown, current?: string | null): AdminIdentityUpdate {
  if (next === null) return { ok: true, identity: null };
  if (typeof next !== 'string') return { ok: false };
  const text = next.trim();
  if (!text) return { ok: true, identity: null };
  if (isAssignableIdentity(text)) return { ok: true, identity: text };
  const currentText = normalizeIdentityText(current);
  if (currentText && text === currentText) return { ok: true, identity: currentText };
  return { ok: false };
}
