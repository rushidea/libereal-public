import { createHash, randomBytes } from 'node:crypto';
import { getEphemeralStore } from '@/lib/ephemeral-store';

const ACCESS_TOKEN_KEY = 'wechat:jssdk:access-token';
const JSAPI_TICKET_KEY = 'wechat:jssdk:ticket';
const TOKEN_SKEW_SECONDS = 300;

type WechatTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type WechatTicketResponse = {
  ticket?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

export type WechatJsSdkSignature = {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
};

export function getWechatOfficialAccountConfig(): { appId: string; secret: string } {
  const appId = process.env.AUTH_WECHAT_MP_ID?.trim() ?? '';
  const secret = process.env.AUTH_WECHAT_MP_SECRET?.trim() ?? '';
  if (!appId || !secret) throw new Error('WECHAT_JSSDK_NOT_CONFIGURED');
  return { appId, secret };
}

function cacheTtlMs(expiresIn = 7200): number {
  return Math.max(60, expiresIn - TOKEN_SKEW_SECONDS) * 1000;
}

export async function getAccessToken(appId: string, secret: string): Promise<string> {
  const store = getEphemeralStore();
  const cached = await store.get(ACCESS_TOKEN_KEY);
  if (cached) return cached;

  const endpoint = new URL('https://api.weixin.qq.com/cgi-bin/token');
  endpoint.searchParams.set('grant_type', 'client_credential');
  endpoint.searchParams.set('appid', appId);
  endpoint.searchParams.set('secret', secret);
  const response = await fetch(endpoint, { cache: 'no-store' });
  const body = await response.json() as WechatTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(`WECHAT_ACCESS_TOKEN_FAILED:${body.errcode ?? response.status}:${body.errmsg ?? 'unknown'}`);
  }
  await store.set(ACCESS_TOKEN_KEY, body.access_token, cacheTtlMs(body.expires_in));
  return body.access_token;
}

async function getJsapiTicket(accessToken: string): Promise<string> {
  const store = getEphemeralStore();
  const cached = await store.get(JSAPI_TICKET_KEY);
  if (cached) return cached;

  const endpoint = new URL('https://api.weixin.qq.com/cgi-bin/ticket/getticket');
  endpoint.searchParams.set('access_token', accessToken);
  endpoint.searchParams.set('type', 'jsapi');
  const response = await fetch(endpoint, { cache: 'no-store' });
  const body = await response.json() as WechatTicketResponse;
  if (!response.ok || body.errcode !== 0 || !body.ticket) {
    throw new Error(`WECHAT_JSAPI_TICKET_FAILED:${body.errcode ?? response.status}:${body.errmsg ?? 'unknown'}`);
  }
  await store.set(JSAPI_TICKET_KEY, body.ticket, cacheTtlMs(body.expires_in));
  return body.ticket;
}

export async function getWechatJsSdkSignature(url: string): Promise<WechatJsSdkSignature> {
  const { appId, secret } = getWechatOfficialAccountConfig();
  const accessToken = await getAccessToken(appId, secret);
  const ticket = await getJsapiTicket(accessToken);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonceStr = randomBytes(16).toString('hex');
  const source = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  return {
    appId,
    timestamp,
    nonceStr,
    signature: createHash('sha1').update(source).digest('hex'),
  };
}

/** Convenience: get access_token using env-configured Official Account credentials. */
export async function getWechatAccessToken(): Promise<string> {
  const { appId, secret } = getWechatOfficialAccountConfig();
  return getAccessToken(appId, secret);
}
