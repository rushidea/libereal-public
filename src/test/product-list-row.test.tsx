import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductListRow from '@/components/ProductListRow';
import type { Product } from '@/types/Product';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/context/CartContext', () => ({
  useCart: () => ({
    addQuickOrderItem: vi.fn(),
  }),
}));

describe('ProductListRow', () => {
  afterEach(() => {
    cleanup();
  });

  it('checks and removes cart rows by product id', () => {
    const product: Product = {
      id: 'db-product-id',
      brand: 'Biosharp',
      catalogNumber: 'BL100A',
      name: 'Test antibody',
      price: 120,
      spec: '50 uL',
      inStock: true,
    };
    const onAddToCart = vi.fn();
    const onRemoveFromCart = vi.fn();
    const isInCart = vi.fn((productId: string) => productId === product.id);

    render(
      <ProductListRow
        product={product}
        onAddToCart={onAddToCart}
        onRemoveFromCart={onRemoveFromCart}
        isInCart={isInCart}
      />,
    );

    expect(isInCart).toHaveBeenCalledWith('db-product-id');
    fireEvent.click(screen.getByRole('button', { name: /已加入/ }));

    expect(onRemoveFromCart).toHaveBeenCalledWith('db-product-id');
    expect(onAddToCart).not.toHaveBeenCalled();
  });
});
