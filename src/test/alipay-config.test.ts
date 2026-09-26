import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { getAlipayConfig, getAlipaySdk } from '@/lib/alipay';

const originalEnv = { ...process.env };

function setRequiredConfig(privateKey: string, publicKey: string) {
  process.env.ALIPAY_APP_ID = 'test-app-id';
  process.env.ALIPAY_SELLER_ID = 'test-seller-id';
  process.env.ALIPAY_APP_PRIVATE_PKCS1_KEY = privateKey;
  process.env.ALIPAY_PUBLIC_KEY = publicKey;
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Alipay configuration', () => {
  it('accepts PKCS8 private keys without PEM headers', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    setRequiredConfig(
      privateKey.replace(/-----[^-]+-----|\s/g, ''),
      publicKey.replace(/-----[^-]+-----|\s/g, ''),
    );

    expect(getAlipayConfig()).toEqual(expect.objectContaining({
      appId: 'test-app-id',
      sellerId: 'test-seller-id',
    }));
    expect(getAlipaySdk()).not.toBeNull();
  });

  it('rejects a public key configured as the application private key', () => {
    const { publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const publicKeyBody = publicKey.replace(/-----[^-]+-----|\s/g, '');
    setRequiredConfig(publicKeyBody, publicKeyBody);

    expect(getAlipayConfig()).toBeNull();
    expect(getAlipaySdk()).toBeNull();
  });
});
