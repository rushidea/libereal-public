import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CartPromotionPanel from '@/components/promotions/CartPromotionPanel';
import type { ProductCartItem } from '@/context/CartContext';
const sampleRule = vi.hoisted(() => ({ id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [sampleRule], CART_ADDON_RULES: [sampleRule], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));

afterEach(cleanup);
const product = (catalogNumber: string, brand: string, quantity: number): ProductCartItem => ({
  product: { id: catalogNumber, catalogNumber, brand, name: catalogNumber, price: 300, inStock: true }, quantity,
});
it('普通方式加入的活动主品显示缺口，且不展示无关活动', () => {
  render(<CartPromotionPanel items={[product('SAMPLE-MAIN', 'Sample', 5)]} />);
  expect(screen.getByText(/还差 1 件/)).toBeInTheDocument();
  expect(screen.queryByText(/unrelated/)).not.toBeInTheDocument();
});
it('无标记主品与附属品自动显示实际应用的优惠', () => {
  render(<CartPromotionPanel items={[product('SAMPLE-MAIN', 'Sample', 6), product('SAMPLE-ADDON', 'Sample', 1)]} />);
  expect(screen.getByText('已按活动价计算')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('普通非活动商品不显示促销提示', () => {
  const { container } = render(<CartPromotionPanel items={[product('OTHER', 'Other', 1)]} />);
  expect(container).toBeEmptyDOMElement();
});
