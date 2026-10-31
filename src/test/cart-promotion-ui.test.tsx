import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartProvider, getCartItemKey, useCart, type ProductCartItem } from '@/context/CartContext';
import CartPage from '@/app/cart/page';
import CartPopover from '@/components/CartPopover';
import CartPromotionPanel from '@/components/promotions/CartPromotionPanel';
import { promotionLines } from './cart-promotion-fixtures';
const sampleRule = vi.hoisted(() => ({ id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] }));
const selectionRule = vi.hoisted(() => ({ id: 'selection-rule', type: 'addon' as const, name: 'Selection', enabled: true, description: 'Synthetic selection.', eligibleBrand: 'Sample', eligibleTerms: ['MAIN'], minQuantity: 1, addonPrice: 9, addonBrand: 'Sample', addonTerms: ['OPT'], addonOptions: [{ catalogNumber: 'OPT-V', price: 30, quantity: 2 }] }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [sampleRule, selectionRule], CART_ADDON_RULES: [sampleRule, selectionRule], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));

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

  it('等待服务端分类时不按客户端价格分为直接购买或询价', async () => {
    const rows = [
      { product: { id: 'p', catalogNumber: 'P', brand: 'Sample', name: 'Pending', price: 0, inStock: true }, quantity: 1 },
    ];
    localStorage.setItem('libereal_guest_cart', JSON.stringify(rows));
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<CartProvider><CartPage /></CartProvider>);
    expect(await screen.findByText('Pending · 待确认')).toBeInTheDocument();
    expect(screen.queryByText('直接购买')).not.toBeInTheDocument();
    expect(screen.queryByText('询价产品')).not.toBeInTheDocument();
  });

  it('统一模式按服务器覆盖结果展示无普通价商品，未覆盖商品仍询价', async () => {
    const rows = [
      { product: { id: 'p', catalogNumber: 'P', brand: 'Sample', name: 'Covered', price: 0, inStock: true }, quantity: 1 },
      { product: { id: 'q', catalogNumber: 'Q', brand: 'Sample', name: 'Inquiry', price: 0, inStock: true }, quantity: 1 },
    ];
    localStorage.setItem('libereal_guest_cart', JSON.stringify(rows));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true, unified: true,
      lineTotals: [5500, null], lineBands: [[{ quantity: 1, unitPriceCents: 5500 }], null],
      ordinaryLineTotals: [null, null], total: 5500, statuses: [] }), { status: 200 })));
    render(<CartProvider><CartPage /></CartProvider>);
    await waitFor(() => {
      expect(screen.getByText('Covered')).toBeInTheDocument();
      expect(screen.getAllByText('¥55.00').length).toBeGreaterThan(0);
      expect(screen.getByText('Inquiry')).toBeInTheDocument();
      expect(screen.getAllByText('询价产品').length).toBeGreaterThan(0);
    });
  });

  it('顶部购物车使用服务器覆盖价格，不按客户端零价判询价', async () => {
    const rows = [{ product: { id: 'p', catalogNumber: 'P', brand: 'Sample', name: 'Covered', price: 0, inStock: true }, quantity: 1 }];
    localStorage.setItem('libereal_guest_cart', JSON.stringify(rows));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true, unified: true,
      lineTotals: [5500], lineBands: [[{ quantity: 1, unitPriceCents: 5500 }]],
      ordinaryLineTotals: [null], total: 5500, statuses: [] }), { status: 200 })));
    render(<CartProvider><CartPopover /></CartProvider>);
    fireEvent.click(screen.getByRole('button', { name: '购物车' }));
    await waitFor(() => expect(screen.getByText('¥55.00')).toBeInTheDocument());
    expect(screen.queryByText('待报价')).not.toBeInTheDocument();
  });

  it('按服务端资格选择变体包，按包数量加入且保存选择意图', async () => {
    localStorage.setItem('libereal_guest_cart', JSON.stringify([{ product: { id: 'm', catalogNumber: 'MAIN', brand: 'Sample', name: 'Main', price: 0, inStock: true }, quantity: 1 }]));
    const option = { id: 'p', variantId: 'v', catalogNumber: 'OPT-V', brand: 'Sample', name: 'Option', spec: 'S', inStock: true,
      addonOption: { catalogNumber: 'OPT-V', price: 30, quantity: 2 }, displayPrice: { salePrice: 50, hasPrice: true, isPromo: false, showGuestDiscount: false } };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('addon-products')) return new Response(JSON.stringify({ products: [option] }), { status: 200 });
      const items = JSON.parse(String(init?.body ?? '[]')) as Array<unknown>; const selected = items.length > 1;
      return new Response(JSON.stringify({ enabled: true, unified: true, lineTotals: selected ? [5500, 3000] : [5500],
        lineBands: selected ? [[{ quantity: 1, unitPriceCents: 5500 }], [{ quantity: 2, unitPriceCents: 1500 }]] : [[{ quantity: 1, unitPriceCents: 5500 }]],
        ordinaryLineTotals: selected ? [null, 10000] : [null], total: selected ? 8500 : 5500, statuses: [],
        qualifications: [{ ruleId: 'selection-rule', name: 'Selection', canChooseAddon: !selected, status: selected ? 'limit-reached' : 'qualified',
          qualification: { currentQuantity: 1, selectedQuantity: selected ? 1 : 0, remainingQuota: selected ? 0 : 1 },
          benefit: { kind: 'fixed_unit_price', amount: 9, currency: 'CNY' }, options: [{ catalogNumber: 'OPT-V', price: 30, quantity: 2 }] }] }), { status: 200 });
    }));
    render(<CartProvider><CartPage /><Driver /></CartProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '加入购物车' }));
    await waitFor(() => {
      const rows = JSON.parse(screen.getByTestId('cart-data').textContent!);
      expect(rows[1]).toMatchObject({ quantity: 2, product: { id: 'p', variantId: 'v', catalogNumber: 'OPT-V' }, addon: { ruleId: 'selection-rule', addonPrice: 30 } });
    });
    const row = screen.getByText('Option').closest('tr')!;
    expect(within(row).getByRole('button', { name: '增加数量' })).toBeDisabled();
    fireEvent.click(within(row).getByRole('button', { name: '减少数量' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('cart-data').textContent!)).toHaveLength(1));
  });

  it('旧模式也按选项包价和包数量添加、增减', async () => {
    localStorage.setItem('libereal_guest_cart', JSON.stringify([{ product: { id: 'm', catalogNumber: 'MAIN', brand: 'Sample', name: 'Main', price: 100, inStock: true }, quantity: 2 }]));
    const option = { id: 'p', variantId: 'v', catalogNumber: 'OPT-V', brand: 'Sample', name: 'Option', spec: 'S', inStock: true,
      addonOption: { catalogNumber: 'OPT-V', price: 30, quantity: 2 }, displayPrice: { salePrice: 50, hasPrice: true, isPromo: false, showGuestDiscount: false } };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(String(input).includes('addon-products')
      ? { products: [option] } : { enabled: false }), { status: 200 })));
    render(<CartProvider><CartPage /><Driver /></CartProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '加入购物车' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('cart-data').textContent!)[1]).toMatchObject({ quantity: 2, addon: { addonPrice: 30 } }));
    let row = screen.getByText('Option').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '增加数量' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('cart-data').textContent!)[1].quantity).toBe(4));
    row = (await screen.findByText('Option')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '减少数量' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('cart-data').textContent!)[1].quantity).toBe(2));
  });

  it('资格视图切换后忽略旧的选品响应', async () => {
    const main = { product: { id: 'm', catalogNumber: 'MAIN', brand: 'Sample', name: 'Main', price: 100, inStock: true }, quantity: 1 };
    let firstResolve!: (value: Response) => void; let secondResolve!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { firstResolve = resolve; });
    const second = new Promise<Response>((resolve) => { secondResolve = resolve; });
    let addonCalls = 0;
    const requests = vi.fn((input: string | URL | Request) => String(input).includes('addon-products')
      ? (++addonCalls === 1 ? first : second) : Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', requests);
    const makePreview = (viewKey: string) => ({ loading: false, viewKey, evals: [], issues: [], adjustments: [], discountTotal: 0,
      lineDiscounts: {}, linePromotionLabels: {}, retry: () => {}, statuses: [], serverLineTotals: [100],
      qualifications: [{ ruleId: 'selection-rule', name: 'Selection', canChooseAddon: true, status: 'qualified',
        qualification: { currentQuantity: 1, selectedQuantity: 0, remainingQuota: 1 }, benefit: { amount: 9 }, options: [] }] });
    const view = render(<CartProvider><CartPromotionPanel items={[main]} preview={makePreview('first') as never} /></CartProvider>);
    await waitFor(() => expect(addonCalls).toBe(1));
    view.rerender(<CartProvider><CartPromotionPanel items={[main]} preview={makePreview('second') as never} /></CartProvider>);
    await waitFor(() => expect(addonCalls).toBe(2));
    const product = (name: string) => ({ id: name, catalogNumber: 'OPT-V', brand: 'Sample', name, inStock: true,
      addonOption: { catalogNumber: 'OPT-V', price: 30, quantity: 2 } });
    await act(async () => secondResolve(new Response(JSON.stringify({ products: [product('Current')] }), { status: 200 })));
    expect(await screen.findByText(/Current/)).toBeInTheDocument();
    await act(async () => firstResolve(new Response(JSON.stringify({ products: [product('Stale')] }), { status: 200 })));
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
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
