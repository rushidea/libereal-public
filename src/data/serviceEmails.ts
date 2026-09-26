/** Public-facing service mailboxes (3 consolidated addresses). */
export const SERVICE_EMAILS = {
  /** Customer support, technical help, general contact, complaints */
  support: 'support@libereal.cn',
  /** Sales inquiries and business cooperation */
  sales: 'sales@libereal.cn',
  /** Legal matters and privacy requests */
  legal: 'legal@libereal.cn',
} as const;

/** Override with SUPPORT_EMAIL in .env when testing; must exist in Cloud Mail before go-live. */
export function getSupportEmail(): string {
  return process.env.SUPPORT_EMAIL?.trim() || SERVICE_EMAILS.support;
}

export { DEFAULT_CLOUD_MAIL_URL, getCloudMailUrl } from '@/lib/cloud-mail';
