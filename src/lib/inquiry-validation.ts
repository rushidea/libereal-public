export const INQUIRY_MAX_ITEMS = 100;
export const INQUIRY_MAX_ITEM_TEXT_LENGTH = 200;
export const INQUIRY_MAX_ADVISOR_FIELD_LENGTH = 50;
export const INQUIRY_IP_LIMIT_PER_WINDOW = 30;
export const INQUIRY_IP_WINDOW_MS = 5 * 60 * 1000;

export const HIGH_VALUE_INQUIRY_THRESHOLD = Number(process.env.HIGH_VALUE_INQUIRY_THRESHOLD ?? 5000);
export const BATCH_INQUIRY_ITEM_THRESHOLD = Number(process.env.BATCH_INQUIRY_ITEM_THRESHOLD ?? 5);

/** 与注册/账户资料中使用的身份取值保持一致 */
export const INQUIRY_ALLOWED_USER_IDENTITIES = new Set([
  '教授',
  '研究员',
  '学生',
  '研究生',
  'PI',
  '博士后',
  '技术员',
  '行政',
  '其他',
]);

export function assertAllowedInquiryIdentity(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!INQUIRY_ALLOWED_USER_IDENTITIES.has(trimmed)) {
    throw new Error('INVALID_IDENTITY');
  }
  return trimmed;
}

/** 询价落库用：保留账户里已有的身份文案，不因历史自由文本阻断提交。 */
export function identityForInquiryFromProfile(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function assertMaxTextLength(value: unknown, max: number, code: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(code);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(code);
  return trimmed || null;
}
