import { AlipaySdk } from 'alipay-sdk';
import { createPrivateKey, createPublicKey } from 'node:crypto';

const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';

type AlipayConfig = {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  sellerId: string;
  gateway: string;
};

function wrapKey(value: string, type: 'PRIVATE KEY' | 'RSA PRIVATE KEY' | 'PUBLIC KEY') {
  const body = value
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s/g, '');
  return `-----BEGIN ${type}-----\n${body}\n-----END ${type}-----`;
}

function normalizePrivateKey(value: string) {
  const candidates = value.includes('BEGIN')
    ? [value.replace(/\\n/g, '\n')]
    : [wrapKey(value, 'RSA PRIVATE KEY'), wrapKey(value, 'PRIVATE KEY')];

  for (const candidate of candidates) {
    try {
      return createPrivateKey(candidate).export({ type: 'pkcs8', format: 'pem' }).toString();
    } catch {
      // Try the other supported private-key container.
    }
  }
  return null;
}

function normalizePublicKey(value: string) {
  try {
    const candidate = value.includes('BEGIN') ? value.replace(/\\n/g, '\n') : wrapKey(value, 'PUBLIC KEY');
    return createPublicKey(candidate).export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    return null;
  }
}

export function getAlipayConfig(): AlipayConfig | null {
  const appId = process.env.ALIPAY_APP_ID?.trim();
  const privateKeyValue = process.env.ALIPAY_APP_PRIVATE_PKCS1_KEY?.trim();
  const alipayPublicKeyValue = process.env.ALIPAY_PUBLIC_KEY?.trim();
  const sellerId = process.env.ALIPAY_SELLER_ID?.trim();
  if (!appId || !privateKeyValue || !alipayPublicKeyValue || !sellerId) return null;
  const privateKey = normalizePrivateKey(privateKeyValue);
  const alipayPublicKey = normalizePublicKey(alipayPublicKeyValue);
  if (!privateKey || !alipayPublicKey) return null;
  return { appId, privateKey, alipayPublicKey, sellerId, gateway: process.env.ALIPAY_GATEWAY?.trim() || SANDBOX_GATEWAY };
}

export function getAlipaySdk() {
  const config = getAlipayConfig();
  if (!config) return null;
  return {
    config,
    sdk: new AlipaySdk({
      appId: config.appId,
      privateKey: config.privateKey,
      keyType: 'PKCS8',
      alipayPublicKey: config.alipayPublicKey,
      gateway: config.gateway,
      signType: 'RSA2',
    }),
  };
}

export function alipayAmountToCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

export function parseAlipayAmountCents(amount: string): number | null {
  const value = amount.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [yuan, cents = ''] = value.split('.');
  return Number(yuan) * 100 + Number(cents.padEnd(2, '0'));
}

export function formatAlipayAmount(amount: number) {
  const cents = alipayAmountToCents(amount);
  if (cents === null) throw new Error('INVALID_ALIPAY_AMOUNT');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
