import { publicSiteUrl } from '@/lib/site-url';

/** OAuth entry URL that must be opened inside the WeChat in-app browser. */
export function buildWeChatInAppLaunchUrl(callbackUrl: string, origin?: string): string {
  const params = new URLSearchParams({ callbackUrl });
  const path = `/api/auth/wechat/launch?${params.toString()}`;
  return origin ? `${origin.replace(/\/$/, '')}${path}` : publicSiteUrl(path);
}
