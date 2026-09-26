import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePromotionPreview } from '@/components/promotions/usePromotionPreview';
const campaign = { id: 'rule', name: 'Sample add-on offer', version: 1, status: 'active', startsAt: '2026-01-01', endsAt: '2027-01-01',
  definition: { schemaVersion: 1, template: 'addon', repeat: true, maxApplications: null, partialBenefit: true,
    groups: [{ key: 'main', role: 'qualifier', unit: '盒', quantity: 6 }, { key: 'addon', role: 'benefit', unit: '卷', quantity: 1 }], benefit: { kind: 'fixed-price', unitPriceCents: 5000 } },
  bindings: [{ productId: 'sample-main', variantId: null, groupKey: 'main' }, { productId: 'sample-addon', variantId: null, groupKey: 'addon' }] };
const items = [{ product: { id: 'sample-main', name: 'Sample main', brand: 'Sample', catalogNumber: 'SAMPLE-MAIN', price: 100 }, quantity: 6 },
  { product: { id: 'sample-addon', name: 'Sample add-on', brand: 'Sample', catalogNumber: 'SAMPLE-ADDON', price: 300 }, quantity: 1 }];
function Harness() {
  const preview = usePromotionPreview(items as never);
  return <div>{preview.loading ? '加载中' : preview.issues.length ? preview.issues[0].message : `${preview.discountTotal}:${preview.statuses?.[0]?.message}`}</div>;
}
afterEach(() => vi.restoreAllMocks());
it('购物车等待服务端绑定后计算合成规则', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true,
    resolved: [{ id: '0', productId: 'sample-main', variantId: null }, { id: '1', productId: 'sample-addon', variantId: null }], campaigns: [campaign] }) }));
  render(<Harness />);
  expect(screen.getByText('加载中')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/250:按活动价计算 1 件/)).toBeInTheDocument());
});
it('活动接口失败时阻止静默按错误金额结算', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '活动服务不可用' }) }));
  render(<Harness />);
  await waitFor(() => expect(screen.getByText('活动服务不可用，请刷新后重试')).toBeInTheDocument());
});
