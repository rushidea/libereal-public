import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductListRow from '@/components/ProductListRow';
import type { Product } from '@/types/Product';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/context/CartContext', async () => {
  const actual = await vi.importActual<typeof import('@/context/CartContext')>('@/context/CartContext');
  return {
    ...actual,
    useCart: () => ({
      addItem: vi.fn(),
      removeItem: vi.fn(),
      isInCart: vi.fn(() => false),
      addQuickOrderItem: vi.fn(),
      items: [],
      totalItems: 0,
      updateQuantity: vi.fn(),
      clearCart: vi.fn(),
      clearQuickOrderItems: vi.fn(),
      forceSync: vi.fn(),
      getCartHistory: vi.fn(() => []),
    }),
  };
});

describe('ProductListRow variant selection', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens a selection dialog instead of adding a default variant', () => {
    const product: Product = {
      id: 'db-product-id',
      brand: 'Abcepta',
      catalogNumber: 'AM1981a',
      name: 'Test antibody',
      price: 1250,
      displayPrice: { salePrice: 1250, showGuestDiscount: false, isPromo: false, hasPrice: true },
      spec: '50 µl',
      inStock: true,
      variants: [
        { id: 'v-50', catalogNumber: 'AM1981a', spec: '50 µl', price: 1250, displayPrice: { salePrice: 1250, showGuestDiscount: false, isPromo: false, hasPrice: true } },
        { id: 'v-100', catalogNumber: 'AM1981a', spec: '100 µl', price: 2050, displayPrice: { salePrice: 2050, showGuestDiscount: false, isPromo: false, hasPrice: true } },
      ],
    };
    const onAddToCart = vi.fn();
    const onRemoveFromCart = vi.fn();

    render(
      <ProductListRow
        product={product}
        onAddToCart={onAddToCart}
        onRemoveFromCart={onRemoveFromCart}
        isInCart={() => false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /订购/ }));
    expect(onAddToCart).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: product.name })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /100 µl/ }));
    fireEvent.click(screen.getByRole('button', { name: /加入购物车/ }));

    expect(onAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: 'v-100',
        catalogNumber: 'AM1981a',
        spec: '100 µl',
        price: 2050,
        displayPrice: { salePrice: 2050, showGuestDiscount: false, isPromo: false, hasPrice: true },
      }),
    );
  });
});
