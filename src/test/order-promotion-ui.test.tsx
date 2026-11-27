import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderPage from '@/app/order/page';
import { promotionLines } from './cart-promotion-fixtures';

const cart = vi.hoisted(() => ({ items: [] as unknown[], syncFromDb: vi.fn(async () => {}), removeItem: vi.fn() }));
vi.mock('@/context/CartContext', () => ({ useCart: () => cart, getCartItemKey: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'synthetic-checkout-user' } }, status: 'authenticated' }),
}));
vi.mock('@/components/AdaptiveHeader', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@/components/mobile/MobileBottomNav', () => ({ default: () => null }));
vi.mock('@/components/legal/LegalConsentModal', () => ({ default: () => null }));
vi.mock('@/components/account/OrganizationContextSelect', () => ({ default: () => null }));

describe('结算页服务端合成活动金额', () => {
  beforeEach(() => {
    cart.items = promotionLines().map((line) => ({
      product: { ...line.product, inStock: true, leadTime: line.product.catalogNumber === 'SAMPLE-ADDON-1' ? '1-2 周' : '现货' }, quantity: line.quantity,
      ...(line.promoMark ? { addon: { ruleId: line.promoMark.ruleId, addonPrice: 50 } } : {}),
    }));
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const data = String(url).includes('pricing-preview') ? {
        subtotal: 900, totalBeforePoints: 650, total: 640,
        promotionDiscount: 250, promotionAdjustments: [{ label: '加购优惠', amount: -250 }],
        adjustments: [], points: { pointsDiscount: 10 },
        items: [{ unitPrice: 100, lineTotal: 600, finalLineTotal: 600 }, { unitPrice: 300, lineTotal: 300, finalLineTotal: 50 }],
      } : String(url).includes('addresses') ? { addresses: [] } : { personalPoints: 0, group: null };
      return new Response(JSON.stringify(data), { status: 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('总额保留服务端 640 元并展示 50 元加购行，不重复扣减 250 元活动优惠或积分', async () => {
    render(<OrderPage />);
    await waitFor(() => expect(screen.getByText('应付总额').parentElement).toHaveTextContent('¥640.00'));
    expect(screen.getByText('¥50.00')).toBeInTheDocument();
    expect(screen.queryByText('¥390.00')).not.toBeInTheDocument();
  });

  it('结算页提供促销收费方式与库存交期复核', async () => {
    render(<OrderPage />);
    const review = await screen.findByRole('region', { name: '活动与履约复核' });
    await waitFor(() => expect(review).toHaveTextContent('付费加购'));
    await waitFor(() => expect(review).toHaveTextContent('计入订单 ¥50.00'));
    expect(review).toHaveTextContent('货期 1-2 周');
  });

  it('多价档按实际单价和数量展示，不显示虚构的平均单价', async () => {
    const first = cart.items[0] as { product: unknown };
    cart.items = [{ product: first.product, quantity: 2 }];
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(
      String(url).includes('pricing-preview') ? {
        subtotal: 150, totalBeforePoints: 150, total: 150, promotionDiscount: 0, promotionAdjustments: [], adjustments: [],
        items: [{ unitPrice: null, originalUnitPrice: 100, includedPromotionDiscount: 50, quantity: 2,
          lineTotal: 150, finalLineTotal: 150, finalUnitPrice: null, priceTiers: [{ unitPrice: 100, quantity: 1 }, { unitPrice: 50, quantity: 1 }] }],
      } : String(url).includes('addresses') ? { addresses: [] } : { personalPoints: 0, group: null },
    ), { status: 200 }));
    render(<OrderPage />);
    expect(await screen.findByText('¥100.00 × 1')).toBeInTheDocument();
    expect(screen.getByText('¥50.00 × 1')).toBeInTheDocument();
    expect(screen.queryByText('¥75.00 × 2')).not.toBeInTheDocument();
  });

  it('only treats an unpriced product as orderable after server coverage', async () => {
    const first = cart.items[0] as { product: Record<string, unknown> };
    cart.items = [{ product: { ...first.product, price: 0, promotionalPrice: null }, quantity: 1 }];
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(
      String(url).includes('/promotions/cart') ? { enabled: true, unified: true, lineTotals: [5000],
        lineBands: [[{ quantity: 1, unitPriceCents: 5000 }]], ordinaryLineTotals: [null], total: 5000, statuses: [] }
        : String(url).includes('pricing-preview') ? { subtotal: 50, totalBeforePoints: 50, total: 50,
          promotionDiscount: 0, promotionAdjustments: [], adjustments: [], items: [{ unitPrice: 50, quantity: 1, lineTotal: 50, finalLineTotal: 50 }] }
          : String(url).includes('addresses') ? { addresses: [] } : { personalPoints: 0, group: null },
    ), { status: 200 }));
    render(<OrderPage />);
    await waitFor(() => expect(screen.getByText('应付总额').parentElement).toHaveTextContent('¥50.00'));
    expect(screen.queryByText('待报价')).not.toBeInTheDocument();
  });

  it('预览拒绝活动条件时展示提示并禁用下单', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(
      String(url).includes('pricing-preview') ? { error: '活动条件不满足，请补足主品或移除加购商品' } : { addresses: [] },
    ), { status: String(url).includes('pricing-preview') ? 400 : 200 }));
    render(<OrderPage />);
    expect(await screen.findByText('活动条件不满足，请补足主品或移除加购商品')).toBeInTheDocument();
    expect(screen.getByText('应付总额').parentElement).toHaveTextContent('待确认');
    expect(screen.queryByText('¥600.00')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认下单/ })).toBeDisabled();
  });
});
