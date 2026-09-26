import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductDetailClient from '@/app/products/[id]/ProductDetailClient';
import type { Product } from '@/types/Product';

const addItem = vi.fn();
const removeItem = vi.fn();
const isInCart = vi.fn(() => false);
const cart = vi.hoisted(() => ({ items: [] as unknown[] }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const sampleRule = vi.hoisted(() => ({ id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [sampleRule], CART_ADDON_RULES: [sampleRule], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('@/context/CartContext', async () => {
  const actual = await vi.importActual<typeof import('@/context/CartContext')>('@/context/CartContext');
  return {
    ...actual,
    useCart: () => ({
      addItem,
      removeItem,
      isInCart,
      addQuickOrderItem: vi.fn(),
      items: cart.items,
      totalItems: 0,
      updateQuantity: vi.fn(),
      clearCart: vi.fn(),
      clearQuickOrderItems: vi.fn(),
      forceSync: vi.fn(),
      getCartHistory: vi.fn(() => []),
    }),
  };
});

vi.mock('@/components/AdaptiveHeader', () => ({
  default: () => <div data-testid="adaptive-header" />,
}));

vi.mock('@/components/SiteFooter', () => ({
  default: () => <div data-testid="site-footer" />,
}));

vi.mock('@/components/mobile/MobileBottomNav', () => ({
  default: () => <div data-testid="mobile-bottom-nav" />,
}));

describe('ProductDetailClient add to cart', () => {
  afterEach(() => {
    cleanup();
    addItem.mockReset();
    removeItem.mockReset();
    isInCart.mockReset();
    isInCart.mockReturnValue(false);
    cart.items = [];
    router.push.mockReset();
    router.replace.mockReset();
  });

  it('adds the currently selected variant without opening a selection dialog', () => {
    const product: Product = {
      id: 'p-base',
      brand: 'Sample',
      catalogNumber: 'SAMPLE-PRODUCT-1',
      name: 'Sample reagent',
      price: 55,
      displayPrice: { salePrice: 55, showGuestDiscount: false, isPromo: false, hasPrice: true },
      spec: '500mL',
      inStock: true,
    };
    const packageVariant: Product = {
      id: 'p-case',
      variantId: 'v-case',
      brand: 'Sample',
      catalogNumber: 'SAMPLE-PRODUCT-1',
      name: 'Sample reagent',
      price: 480,
      displayPrice: { salePrice: 480, showGuestDiscount: false, isPromo: false, hasPrice: true },
      spec: '500mL × 10瓶',
      inStock: true,
    };

    render(
      <ProductDetailClient
        product={product}
        variants={[packageVariant]}
        related={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /加入购物车/ }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogNumber: 'SAMPLE-PRODUCT-1',
        spec: '500mL',
        price: 55,
      }),
    );
  });

  it('在产品页展示合成促销活动资格与缺口', () => {
    cart.items = [{
      product: {
        id: 'gel-cart',
        brand: 'Sample',
        catalogNumber: 'SAMPLE-MAIN-1',
        name: 'Sample main item',
        price: 128,
        inStock: true,
      },
      quantity: 5,
    }];

    render(
      <ProductDetailClient
        product={{
          id: 'gel-detail',
          brand: 'Sample',
          catalogNumber: 'SAMPLE-MAIN-1',
          name: 'Sample main item',
          price: 128,
          displayPrice: { salePrice: 128, showGuestDiscount: false, isPromo: false, hasPrice: true },
          inStock: true,
        }}
        variants={[]}
        related={[]}
      />,
    );

    expect(screen.getByRole('region', { name: '促销活动' })).toHaveTextContent('还差 1 件');
    expect(screen.getByRole('progressbar', { name: /Synthetic add-on offer.*活动进度/ })).toHaveAttribute('aria-valuenow', '5');
  });

  it('规格切换同步更新货号、价格和加购对象，不跳转到可能不存在的变体路由', () => {
    const product: Product = {
      id: 'p-parent',
      brand: 'Sample',
      catalogNumber: 'SAMPLE-PRODUCT-2',
      name: 'Sample buffer',
      price: 55,
      displayPrice: { salePrice: 55, showGuestDiscount: false, isPromo: false, hasPrice: true },
      spec: '100 mL',
      inStock: true,
    };
    const variant: Product = {
      id: 'p-variant',
      variantId: 'v-variant',
      brand: 'Sample',
      catalogNumber: 'SAMPLE-PRODUCT-2B',
      name: 'Sample buffer',
      price: 90,
      displayPrice: { salePrice: 90, showGuestDiscount: false, isPromo: false, hasPrice: true },
      spec: '500 mL',
      inStock: true,
    };

    render(<ProductDetailClient product={product} variants={[variant]} related={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /500 mL/ }));
    expect(screen.getByText('SAMPLE-PRODUCT-2B')).toBeInTheDocument();
    expect(screen.getAllByText('¥90.00')).toHaveLength(2);
    expect(router.replace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /加入购物车/ }));
    expect(addItem).toHaveBeenCalledWith(expect.objectContaining({
      catalogNumber: 'SAMPLE-PRODUCT-2B',
      spec: '500 mL',
      price: 90,
    }));
  });

  it('缺货规格显示货期并禁用采购动作', () => {
    render(
      <ProductDetailClient
        product={{
          id: 'p-oos',
          brand: 'Sample',
          catalogNumber: 'OOS-001',
          name: '缺货测试试剂',
          price: 100,
          displayPrice: { salePrice: 100, showGuestDiscount: false, isPromo: false, hasPrice: true },
          inStock: false,
          stockQuantity: 0,
          leadTime: '2-3 周',
        }}
        variants={[]}
        related={[]}
      />,
    );

    expect(screen.getByText('暂时缺货')).toBeInTheDocument();
    expect(screen.getByText('预计 2-3 周')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '缺货' })).toBeDisabled();
  });
});
