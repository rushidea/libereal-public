// @vitest-environment node

import { webcrypto } from 'node:crypto';
import {
  BasicConstraintsExtension,
  cryptoProvider,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509Certificate,
  X509CertificateGenerator,
} from '@peculiar/x509';
import { validateCertificatePath } from '@simplewebauthn/server/helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const originalProviders = Array.from(cryptoProvider.entries());

type KeyPair = CryptoKeyPair;

const certificateDates = {
  notBefore: new Date('2020-01-01T00:00:00.000Z'),
  notAfter: new Date('2040-01-01T00:00:00.000Z'),
};

async function createKeyPair(): Promise<KeyPair> {
  return webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as Promise<KeyPair>;
}

async function createRoot(name: string, serialNumber: string) {
  const keys = await createKeyPair();
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber,
    name: `CN=${name}`,
    keys,
    ...certificateDates,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [
      new BasicConstraintsExtension(true, 1, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  });
  return { certificate, keys };
}

async function createLeaf(
  name: string,
  serialNumber: string,
  issuer: { certificate: X509Certificate; keys: KeyPair },
) {
  const keys = await createKeyPair();
  const certificate = await X509CertificateGenerator.create({
    serialNumber,
    subject: `CN=${name}`,
    issuer: issuer.certificate.subject,
    publicKey: keys.publicKey,
    signingKey: issuer.keys.privateKey,
    ...certificateDates,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  });
  return { certificate, keys };
}

describe('passkey attestation certificate path validation', () => {
  let attackerLeaf: X509Certificate;
  let attackerSelfSignedRoot: X509Certificate;
  let genuineLeaf: X509Certificate;
  let genuineRoot: X509Certificate;

  beforeAll(async () => {
    cryptoProvider.set(webcrypto as unknown as Crypto);
    const attackerRoot = await createRoot('Attacker Root', '1001');
    const attacker = await createLeaf('Attacker Leaf', '1002', attackerRoot);
    attackerLeaf = attacker.certificate;
    attackerSelfSignedRoot = attackerRoot.certificate;

    const genuine = await createRoot('Genuine Root', '2001');
    const leaf = await createLeaf('Genuine Leaf', '2002', genuine);
    genuineLeaf = leaf.certificate;
    genuineRoot = genuine.certificate;
  });

  afterAll(() => {
    cryptoProvider.clear();
    for (const [name, provider] of originalProviders) cryptoProvider.set(name, provider);
  });

  it('accepts a leaf chained to a configured trust anchor', async () => {
    await expect(
      validateCertificatePath([genuineLeaf.toString()], [genuineRoot.toString()]),
    ).resolves.toBe(true);
  });

  it('rejects an attacker-controlled self-signed root when it is absent from trust anchors', async () => {
    await expect(
      validateCertificatePath(
        [attackerLeaf.toString(), attackerSelfSignedRoot.toString()],
        [genuineRoot.toString()],
      ),
    ).rejects.toThrow('x5c could not be chained to any specified trust anchor');
  });
});
