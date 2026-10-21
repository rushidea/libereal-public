import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MyCouponsPage from '@/app/account/coupons/page';

vi.mock('@/components/AdaptiveHeader', () => ({ default: () => null }));
vi.mock('@/components/account/AccountSidebar', () => ({ default: () => null }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => null }));
vi.mock('@/components/mobile/MobileBottomNav', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('我的优惠券', () => {
  it('shows the applicability text returned for each coupon', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        instanceId: 'inst-1',
        code: 'ABCEPTA100',
        name: '品牌满减券',
        type: 'threshold',
        threshold: 100,
        discount: 20,
        expiresAt: null,
        scopeLabel: '仅限 Abcepta 品牌',
      }],
    })));

    render(<MyCouponsPage />);

    expect(await screen.findByText('仅限 Abcepta 品牌')).toBeInTheDocument();
    expect(screen.getByText('品牌满减券')).toBeInTheDocument();
    expect(screen.getByText('ABCEPTA100')).toBeInTheDocument();
  });
});
