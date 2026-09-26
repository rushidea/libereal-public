/**
 * 微信缓存破局用的统一分享版本号。
 * 微信按「页面 URL」缓存整张 og 卡片、按「图片 URL」缓存缩略图；换 og 图后改这里一处，
 * 分享链接、og:image、JS-SDK imgUrl 三层 URL 都会带上新 ?v=，两层缓存一起破。
 */
export const SHARE_VERSION = '20260803';

/** 在 URL（相对/绝对均可）上设置或覆盖 `v` 查询参数，用于微信缓存破局。 */
export function withVersion(url: string, version: string): string {
  try {
    const base = url.startsWith('http') ? url : `http://placeholder.local${url}`;
    const parsed = new URL(base);
    parsed.searchParams.set('v', version);
    return url.startsWith('http') ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

export type PromotionShareConfig = {
  path: string;
  title: string;
  description: string;
  campaign: string;
  openGraphImage: string;
  wechatImage: string;
  imageAlt: string;
};

export type PromotionShareConfigKey = keyof typeof PROMOTION_SHARE_CONFIGS;

export type PromotionShareMedium =
  | 'timeline'
  | 'appmessage'
  | 'weibo'
  | 'qq'
  | 'native_share'
  | 'copy_link';

export function buildPromotionShareUrl(
  currentUrl: string,
  medium: PromotionShareMedium,
  campaign: string,
): string {
  const url = new URL(currentUrl);
  url.hash = '';
  const source = medium === 'native_share'
    ? 'system'
    : medium === 'copy_link'
      ? 'copied_link'
      : medium === 'weibo'
        ? 'weibo'
        : medium === 'qq'
          ? 'qq'
          : 'wechat';
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaign);
  // 微信按页面 URL 缓存整张 og 卡；带版本号让换图后当新链接重新抓取
  url.searchParams.set('v', SHARE_VERSION);
  return url.toString();
}

export const PROMOTION_SHARE_CONFIGS = {} satisfies Record<string, PromotionShareConfig>;
