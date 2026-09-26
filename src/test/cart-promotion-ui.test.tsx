import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartProvider, getCartItemKey, useCart, type ProductCartItem } from '@/context/CartContext';
import CartPage from '@/app/cart/page';
import { promotionLines } from './cart-promotion-fixtures';
const sampleRule = vi.hoisted(() => ({ id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [sampleRule], CART_ADDON_RULES: [sampleRule], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/components/AdaptiveHeader', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@/components/WhyChooseUs', () => ({ default: () => null }));
vi.mock('@/components/mobile/MobileBottomNav', () => ({ default: () => null }));

function cartRows(quantity = 5): ProductCartItem[] {
  return promotionLines(quantity).map((line) => ({
    product: { ...line.product, name: line.product.name!, price: line.product.price ?? 0, spec: undefined, inStock: true },
    quantity: line.quantity,
    ...(line.promoMark ? { addon: { ruleId: line.promoMark.ruleId, addonPrice: 50 } } : {}),
  }));
}
function Driver() {
  const cart = useCart();
  return <div>
    <button onClick={() => cart.updateQuantity(getCartItemKey(cart.items[0]), 6)}>补足主品</button>
    <button onClick={() => cart.updateQuantity(getCartItemKey(cart.items[0]), 5)}>减少主品</button>
    <button onClick={() => cart.removeItem(getCartItemKey(cart.items[1]))}>移除加购</button>
    <button onClick={() => {
      const addon = cartRows()[1];
      cart.addAddonItem(addon.product, addon.addon!.ruleId, 50);
      cart.addAddonItem(addon.product, addon.addon!.ruleId, 50);
    }}>连续加购</button>
    <output data-testid="cart-data">{JSON.stringify(cart.items)}</output>
  </div>;
}

describe('购物车合成加购交互', () => {
  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
    });
    const addon = cartRows()[1].product;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      products: [{ ...addon, price: undefined, displayPrice: { salePrice: 300, hasPrice: true, isPromo: false, showGuestDiscount: false } }],
    }), { status: 200 })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('主商品显示合成规则门槛与加购项，条件失效后暂停结算', async () => {
    localStorage.setItem('libereal_guest_cart', JSON.stringify(cartRows().slice(0, 1)));
    render(<CartProvider><CartPage /><Driver /></CartProvider>);
    expect(await screen.findByText('还需 1 件主品，可按 ¥50 加购')).toBeInTheDocument();
    expect(screen.queryByText('加购价 ¥50')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('补足主品'));
    expect(await screen.findByText('加购价 ¥50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }));
    expect(await screen.findByText('加购价 ¥50.00')).toBeInTheDocument();
    expect(screen.getByText('¥650.00')).toBeInTheDocument();
    const rows = JSON.parse(screen.getByTestId('cart-data').textContent!);
    expect(rows[1].product.displayPrice.salePrice).toBe(300);
    expect(rows[1].addon.addonPrice).toBe(50);
    fireEvent.click(screen.getByText('连续加购'));
    expect(JSON.parse(screen.getByTestId('cart-data').textContent!)[1].quantity).toBe(1);
    fireEvent.click(screen.getByText('减少主品'));
    expect(await screen.findByRole('alert')).toHaveTextContent('活动条件不满足');
    expect(screen.getByRole('button', { name: '立即下单' })).toBeDisabled();
    fireEvent.click(screen.getByText('移除加购'));
    await waitFor(() => expect(screen.getByRole('button', { name: '立即下单' })).toBeEnabled());
  });

  it('恢复历史中的普通与加购同商品后分别修改和移除', async () => {
    const rows = cartRows(6);
    rows.push({ product: rows[1].product, quantity: 3 });
    localStorage.setItem('libereal_guest_cart', JSON.stringify(rows));
    render(<CartProvider><Driver /></CartProvider>);
    fireEvent.click(screen.getByText('移除加购'));
    const restored = JSON.parse(screen.getByTestId('cart-data').textContent!);
    expect(restored).toHaveLength(2);
    expect(restored[1].quantity).toBe(3);
    expect(restored[1].addon).toBeUndefined();
  });

  it('加载失败显示重试入口', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network'));
    localStorage.setItem('libereal_guest_cart', JSON.stringify(cartRows(6).slice(0, 1)));
    render(<CartProvider><CartPage /></CartProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('加购价 ¥50')).toBeInTheDocument();
  });
});
