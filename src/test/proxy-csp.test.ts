import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildCsp, proxy } from '@/proxy';

describe('proxy CSP', () => {
  it('allows form submission to the production and sandbox Alipay gateways', () => {
    const csp = buildCsp(true);

    expect(csp).toContain(
      "form-action 'self' https://openapi.alipay.com https://openapi-sandbox.dl.alipaydev.com",
    );
  });

  it('allows the Knocket widget and drops Chatway hosts', () => {
    const csp = buildCsp(true);

    expect(csp).toContain('https://trtc.io');
    expect(csp).toContain('https://api.trtc.io');
    expect(csp).toContain('wss://wss.im.qcloud.com');
    expect(csp).toContain('wss://*.my-imcloud.com');
    expect(csp).toContain('https://web.sdk.qcloud.com');
    expect(csp).toContain('https://web.sdk.cloud.tencent.cn');
    expect(csp).toContain('https://web.sdk.tencent.cn');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).toContain('https://console.trtc.io');
    expect(csp).not.toContain('chatway');
  });
});

describe('proxy admin hide', () => {
  it('does not rewrite anonymous /admin in the edge proxy', () => {
    const response = proxy(new NextRequest('http://localhost/admin/access'));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('does not require a session to open /mail', () => {
    const response = proxy(new NextRequest('http://localhost/mail'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('lets a session cookie continue into /admin', () => {
    const response = proxy(new NextRequest('http://localhost/admin', {
      headers: { cookie: 'authjs.session-token=test-token' },
    }));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
