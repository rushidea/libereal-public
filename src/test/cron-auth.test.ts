import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  accountReceivableFindMany: vi.fn(),
  creditAccountFindMany: vi.fn(),
  runDailyTierReview: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  reconcile: vi.fn(),
  closeStale: vi.fn(),
  listUrls: vi.fn(),
  submitIndexNow: vi.fn(),
  submitBaidu: vi.fn(),
  ping: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountReceivable: { findMany: mocks.accountReceivableFindMany },
    creditAccount: { findMany: mocks.creditAccountFindMany },
  },
}));

vi.mock('@/lib/customer-credit', () => ({
  CREDIT_REVIEW_POLICY: {
    reminderIntervalDays: 7,
    reminderAfterDays: 7,
    holdAfterDays: 90,
    limitedAfterDays: 60,
    limitedCreditLimit: 0,
  },
  creditRestrictionForOverdueDays: vi.fn(),
  overdueDaysFromDueAt: vi.fn(),
  runDailyTierReview: mocks.runDailyTierReview,
}));

vi.mock('@/lib/ephemeral-store', () => ({
  getEphemeralStore: () => ({
    acquireLock: mocks.acquireLock,
    releaseLock: mocks.releaseLock,
  }),
}));

vi.mock('@/lib/background-tasks', () => ({
  enqueueBackgroundTask: vi.fn(),
}));

vi.mock('@/lib/order-auto-close', () => ({
  reconcilePendingAlipayOrderPoints: mocks.reconcile,
  closeStalePendingOrders: mocks.closeStale,
}));

vi.mock('@/lib/seo/indexnow', () => ({
  listRecentlyUpdatedStorefrontUrls: mocks.listUrls,
  submitIndexNowUrls: mocks.submitIndexNow,
  pingBingSitemap: mocks.ping,
}));

vi.mock('@/lib/seo/baidu-push', () => ({
  submitBaiduPushUrls: mocks.submitBaidu,
}));

import { GET as autoCloseGET, POST as autoClosePOST } from '@/app/api/cron/auto-close/route';
import { GET as creditReviewGET, POST as creditReviewPOST } from '@/app/api/cron/credit-review/route';
import { GET as indexNowGET, POST as indexNowPOST } from '@/app/api/cron/indexnow/route';
import { cronUnauthorizedResponse, isCronRequestAuthorized } from '@/lib/cron-auth';

const originalCronSecret = process.env.CRON_SECRET;

const routes = [
  {
    name: 'auto-close',
    path: '/api/cron/auto-close',
    handlers: [autoCloseGET, autoClosePOST],
    started: () => mocks.reconcile,
  },
  {
    name: 'credit-review',
    path: '/api/cron/credit-review',
    handlers: [creditReviewGET, creditReviewPOST],
    started: () => mocks.acquireLock,
  },
  {
    name: 'indexnow',
    path: '/api/cron/indexnow',
    handlers: [indexNowGET, indexNowPOST],
    started: () => mocks.listUrls,
  },
] as const;

function cronRequest(path: string, init?: { method?: string; headers?: Record<string, string> }) {
  return new NextRequest(`https://libereal.cn${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'cron-secret';
  mocks.accountReceivableFindMany.mockResolvedValue([]);
  mocks.creditAccountFindMany.mockResolvedValue([]);
  mocks.runDailyTierReview.mockResolvedValue(0);
  mocks.acquireLock.mockResolvedValue('lock-token');
  mocks.releaseLock.mockResolvedValue(undefined);
  mocks.reconcile.mockResolvedValue({ reconciled: 0, failed: 0 });
  mocks.closeStale.mockResolvedValue({ closed: 0, skipped: 0 });
  mocks.listUrls.mockResolvedValue([]);
  mocks.submitIndexNow.mockResolvedValue({ submitted: 0, batches: 0 });
  mocks.submitBaidu.mockResolvedValue({ submitted: 0, batches: 0 });
  mocks.ping.mockResolvedValue({ ok: true });
});

afterEach(() => {
  process.env.CRON_SECRET = originalCronSecret;
});

describe('isCronRequestAuthorized', () => {
  it('fails closed when CRON_SECRET is missing, empty, or blank', () => {
    for (const secret of [undefined, '', '   ', '\n']) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
      expect(isCronRequestAuthorized({
        headers: new Headers({
          'x-cron-secret': 'cron-secret',
          'x-forwarded-for': '127.0.0.1',
          'x-real-ip': '::1',
          authorization: 'Bearer cron-secret',
        }),
      })).toBe(false);
    }
  });

  it('accepts only the shared secret header and ignores surrounding whitespace', () => {
    process.env.CRON_SECRET = ' cron-secret ';
    expect(isCronRequestAuthorized({
      headers: new Headers({ 'x-cron-secret': 'cron-secret' }),
    })).toBe(true);
    expect(isCronRequestAuthorized({
      headers: new Headers({ 'x-cron-secret': 'cron-secret-extra' }),
    })).toBe(false);
    expect(isCronRequestAuthorized({
      headers: new Headers({ 'x-cron-secret': 'cron' }),
    })).toBe(false);
    expect(isCronRequestAuthorized({
      headers: new Headers({ 'x-forwarded-for': '127.0.0.1', 'x-real-ip': 'localhost' }),
    })).toBe(false);
    expect(isCronRequestAuthorized({
      headers: new Headers({ authorization: 'Bearer cron-secret' }),
    })).toBe(false);
  });

  it('compares the secret as UTF-8 bytes', () => {
    process.env.CRON_SECRET = '定时密钥';
    const headersFor = (value: string | null) => ({
      get: (name: string) => (name.toLowerCase() === 'x-cron-secret' ? value : null),
    });
    expect(isCronRequestAuthorized({ headers: headersFor('定时密钥') })).toBe(true);
    expect(isCronRequestAuthorized({ headers: headersFor('定时密') })).toBe(false);
  });

  it('returns 401 without describing which check failed', async () => {
    const response = cronUnauthorizedResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});

describe('cron routes', () => {
  it('rejects every route when the secret is missing, even if the caller claims loopback', async () => {
    delete process.env.CRON_SECRET;
    for (const route of routes) {
      for (const handler of route.handlers) {
        const response = await handler(cronRequest(route.path, {
          headers: {
            'x-forwarded-for': '127.0.0.1, 10.0.0.8',
            'x-real-ip': '::1',
            'x-cron-secret': 'cron-secret',
            authorization: 'Bearer cron-secret',
          },
        }));
        expect(response.status, route.name).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized' });
        expect(route.started()).not.toHaveBeenCalled();
      }
    }
  });

  it('rejects a wrong header, a Bearer token, and a query-string secret', async () => {
    for (const route of routes) {
      const cases: Array<{ headers: Record<string, string> }> = [
        { headers: { 'x-cron-secret': 'wrong-secret', 'x-forwarded-for': '127.0.0.1' } },
        { headers: { authorization: 'Bearer cron-secret', 'x-real-ip': '127.0.0.1' } },
        { headers: { 'x-cron-secret': 'cron-secret-extra' } },
        { headers: {} },
      ];
      for (const handler of route.handlers) {
        for (const init of cases) {
          const response = await handler(cronRequest(`${route.path}?x-cron-secret=cron-secret`, init));
          expect(response.status, route.name).toBe(401);
        }
        expect(route.started()).not.toHaveBeenCalled();
      }
    }
  });

  it('runs each job for GET and POST when x-cron-secret matches', async () => {
    for (const route of routes) {
      for (const [index, handler] of route.handlers.entries()) {
        const response = await handler(cronRequest(route.path, {
          method: index === 0 ? 'GET' : 'POST',
          headers: {
            'x-cron-secret': 'cron-secret',
            'x-forwarded-for': '203.0.113.8',
            authorization: 'Bearer someone-else',
          },
        }));
        expect(response.status, route.name).toBe(200);
      }
      expect(route.started()).toHaveBeenCalledTimes(2);
    }
    expect(mocks.closeStale).toHaveBeenCalledTimes(2);
    expect(mocks.runDailyTierReview).toHaveBeenCalledTimes(2);
    expect(mocks.submitIndexNow).toHaveBeenCalledTimes(2);
    expect(mocks.releaseLock).toHaveBeenCalledTimes(2);
  });
});
