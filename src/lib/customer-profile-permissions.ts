import { normalizeEmail } from '@/lib/auth-helpers';
import { normalizeAdminIdentity, normalizeIdentityText } from '@/lib/identity-options';

const CUSTOMER_TEXT_FIELDS = [
  'name',
  'phone',
  'identity',
  'institution',
  'department',
  'institutionType',
  'institutionName',
  'institutionUnit',
  'institutionFacility',
  'piLab',
  'affiliatedLab',
] as const;

export function providedTextChanged(current: string | null | undefined, next: unknown): boolean {
  if (typeof next !== 'string') return false;
  return next.trim() !== (current ?? '').trim();
}

export function providedBooleanChanged(current: boolean | number | null | undefined, next: unknown): boolean {
  if (typeof next !== 'boolean') return false;
  return next !== Boolean(current);
}

/**
 * identity: null 会清空身份，不能因为不是字符串就跳过客户资料权限。
 * normalizeAdminIdentity 接受、并且和当前值不同的写入同样算改动。
 */
export function identityChangeRequiresCustomerWrite(current: string | null | undefined, next: unknown): boolean {
  if (next === undefined) return false;
  if (next === null) return true;
  const normalized = normalizeAdminIdentity(next, current);
  if (!normalized.ok) return false;
  const currentValue = normalizeIdentityText(current) || null;
  return normalized.identity !== currentValue;
}

export function customerProfileFieldsChanged(
  current: {
    name?: string | null;
    phone?: string | null;
    identity?: string | null;
    institution?: string | null;
    department?: string | null;
    institutionType?: string | null;
    institutionName?: string | null;
    institutionUnit?: string | null;
    institutionFacility?: string | null;
    piLab?: string | null;
    affiliatedLab?: string | null;
    email?: string | null;
    approvalStatus?: string | null;
    isBlacklisted?: boolean | number | null;
    isFrozen?: boolean | number | null;
    isNewUser?: boolean | number | null;
  },
  body: Record<string, unknown>,
): boolean {
  for (const field of CUSTOMER_TEXT_FIELDS) {
    if (field === 'identity') continue;
    if (providedTextChanged(current[field], body[field])) return true;
  }
  if (identityChangeRequiresCustomerWrite(current.identity, body.identity)) return true;
  if (providedTextChanged(current.department, body.institutionDepartment)) return true;
  if (providedBooleanChanged(current.isBlacklisted, body.isBlacklisted)) return true;
  if (providedBooleanChanged(current.isFrozen, body.isFrozen)) return true;
  if (providedBooleanChanged(current.isNewUser, body.isNewUser)) return true;
  if (typeof body.approvalStatus === 'string' && body.approvalStatus !== (current.approvalStatus ?? null)) return true;
  if (typeof body.password === 'string' && body.password.length > 0) return true;
  if (typeof body.email === 'string' && body.email.trim()) {
    const nextEmail = normalizeEmail(body.email.trim());
    if (nextEmail !== (current.email ?? '').toLowerCase()) return true;
  }
  return false;
}

export function tierChangeRequiresPricing(currentTier: string | null | undefined, nextTier: unknown): boolean {
  return typeof nextTier === 'string' && nextTier !== (currentTier ?? '');
}
