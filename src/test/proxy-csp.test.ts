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
});

describe('proxy admin hide', () => {
  it('does not rewrite anonymous /admin in the edge proxy', () => {
    const response = proxy(new NextRequest('http://localhost/admin/access'));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('lets a session cookie continue into /admin', () => {
    const response = proxy(new NextRequest('http://localhost/admin', {
      headers: { cookie: 'authjs.session-token=test-token' },
    }));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
