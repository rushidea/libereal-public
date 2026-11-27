import { act, render, screen, waitFor } from '@testing-library/react';
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
it('统一购物车渲染服务端来源价格并提交数量，不使用客户端售价', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true, unified: true,
    lineTotals: [9000, null], lineBands: [[{ quantity: 6, unitPriceCents: 1500 }], null],
    ordinaryLineTotals: [12000, null], total: 9000, statuses: [] }) });
  vi.stubGlobal('fetch', fetchMock);
  function UnifiedHarness() {
    const preview = usePromotionPreview(items as never);
    return <div>{preview.loading ? '加载中' : `${preview.serverTotal}:${preview.serverLineTotals?.[0]}:${preview.serverLineTotals?.[1]}`}</div>;
  }
  render(<UnifiedHarness />);
  await waitFor(() => expect(screen.getByText('90:90:null')).toBeInTheDocument());
  const request = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(request[0].quantity).toBe(6);
  expect(request[0]).not.toHaveProperty('price');
});
it('会话切换时先隐藏旧账号价格，再请求新账号的服务端结果', async () => {
  const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>(() => {});
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, unified: true,
    lineTotals: [60000, 30000], lineBands: [[{ quantity: 6, unitPriceCents: 10000 }], [{ quantity: 1, unitPriceCents: 30000 }]],
    ordinaryLineTotals: [60000, 30000], total: 90000, statuses: [] }) }).mockReturnValueOnce(pending);
  vi.stubGlobal('fetch', fetchMock);
  function Viewer({ id }: { id: string }) {
    const preview = usePromotionPreview(items as never, id);
    return <div>{preview.loading ? '正在重新核价' : String(preview.serverTotal)}</div>;
  }
  const view = render(<Viewer id="first" />);
  await waitFor(() => expect(screen.getByText('900')).toBeInTheDocument());
  view.rerender(<Viewer id="second" />);
  expect(screen.getByText('正在重新核价')).toBeInTheDocument();
  expect(screen.queryByText('900')).not.toBeInTheDocument();
});

it('定时刷新隐藏旧报价，并忽略过期请求晚到结果', async () => {
  vi.useFakeTimers();
  try {
    const response = (total: number) => ({ ok: true, json: async () => ({ enabled: true, unified: true,
      lineTotals: [total, 0], lineBands: [[{ quantity: 6, unitPriceCents: total / 6 }], [{ quantity: 1, unitPriceCents: 0 }]],
      ordinaryLineTotals: [total, 0], total, statuses: [] }) });
    let resolveSecond!: (value: ReturnType<typeof response>) => void;
    let resolveThird!: (value: ReturnType<typeof response>) => void;
    const second = new Promise<ReturnType<typeof response>>((resolve) => { resolveSecond = resolve; });
    const third = new Promise<ReturnType<typeof response>>((resolve) => { resolveThird = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(6000)).mockReturnValueOnce(second).mockReturnValueOnce(third));
    function RefreshHarness() {
      const preview = usePromotionPreview(items as never);
      return <div>{preview.loading ? '核价中' : String(preview.serverTotal)}</div>;
    }
    render(<RefreshHarness />);
    await act(async () => {});
    expect(screen.getByText('60')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(screen.getByText('核价中')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60000); });
    await act(async () => { resolveThird(response(12000)); });
    expect(screen.getByText('120')).toBeInTheDocument();
    await act(async () => { resolveSecond(response(18000)); });
    expect(screen.getByText('120')).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});
it('旧模式选品视图也随用户切换更新作用域', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
  vi.stubGlobal('fetch', fetchMock);
  function LegacyViewer({ id }: { id: string }) {
    const preview = usePromotionPreview(items as never, id);
    return <div>{preview.loading ? '核价中' : preview.viewKey?.includes('first') ? 'first' : 'second'}</div>;
  }
  const view = render(<LegacyViewer id="first" />);
  await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());
  view.rerender(<LegacyViewer id="second" />);
  expect(screen.getByText('核价中')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
