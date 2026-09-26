// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as setup } from '@/app/api/auth/mfa/setup/route';
import { POST as confirm } from '@/app/api/auth/mfa/confirm/route';
import { POST as disable } from '@/app/api/auth/mfa/disable/route';
import { POST as recoveryCodes } from '@/app/api/auth/mfa/recovery-codes/route';
import { GET as status } from '@/app/api/auth/mfa/status/route';
import { GET as passkeyStatus } from '@/app/api/authenticator/passkey/route';
import { POST as passkeyRegisterOptions } from '@/app/api/authenticator/passkey/register/options/route';
import { POST as passkeyLoginOptions } from '@/app/api/authenticator/passkey/login/options/route';
import { POST as passkeyLoginStart } from '@/app/api/authenticator/passkey/login/start/route';
import { POST as discoverablePasskeyLoginStart } from '@/app/api/authenticator/passkey/login/discoverable/start/route';

describe('MFA routes with the Phase 1 flag disabled', () => {
  const previousFlag = process.env.MFA_PHASE1_ENABLED;
  const previousPasskeyFlag = process.env.PASSKEY_ENABLED;

  beforeEach(() => {
    delete process.env.MFA_PHASE1_ENABLED;
    delete process.env.PASSKEY_ENABLED;
  });

  afterEach(() => {
    if (previousFlag === undefined) delete process.env.MFA_PHASE1_ENABLED;
    else process.env.MFA_PHASE1_ENABLED = previousFlag;
    if (previousPasskeyFlag === undefined) delete process.env.PASSKEY_ENABLED;
    else process.env.PASSKEY_ENABLED = previousPasskeyFlag;
  });

  it('returns 404 without reading auth or database state', async () => {
    expect((await setup(new Request('http://localhost/api/auth/mfa/setup', { method: 'POST', body: '{}' }))).status).toBe(404);
    expect((await confirm(new Request('http://localhost/api/auth/mfa/confirm', { method: 'POST', body: '{}' }))).status).toBe(404);
    expect((await disable(new Request('http://localhost/api/auth/mfa/disable', { method: 'POST' }))).status).toBe(404);
    expect((await recoveryCodes(new Request('http://localhost/api/auth/mfa/recovery-codes', { method: 'POST' }))).status).toBe(404);
    expect((await status()).status).toBe(404);
    expect((await passkeyStatus()).status).toBe(200);
    expect((await passkeyRegisterOptions(new Request('http://localhost/api/authenticator/passkey/register/options', { method: 'POST' }))).status).toBe(404);
    expect((await passkeyLoginOptions(new Request('http://localhost/api/authenticator/passkey/login/options', { method: 'POST', body: '{}' }))).status).toBe(404);
    expect((await passkeyLoginStart(new Request('http://localhost/api/authenticator/passkey/login/start', { method: 'POST', body: '{}' }))).status).toBe(404);
    expect((await discoverablePasskeyLoginStart()).status).toBe(404);
  });
});
