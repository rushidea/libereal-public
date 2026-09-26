/** Cloud Mail Webmail (maillab/cloud-mail on Cloudflare Workers). */
export const DEFAULT_CLOUD_MAIL_URL = 'https://mail.libereal.cn';

export function getCloudMailUrl(): string {
  const url = process.env.NEXT_PUBLIC_CLOUD_MAIL_URL?.trim();
  return (url || DEFAULT_CLOUD_MAIL_URL).replace(/\/$/, '');
}
