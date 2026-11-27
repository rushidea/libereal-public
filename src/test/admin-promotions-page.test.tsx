import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PromotionsPage from '@/app/admin/promotions/page';

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it('resolves current all-variant bindings before showing catalog trial quantities', async () => {
  const definition = { schemaVersion: 1, template: 'direct-price', repeat: true, maxApplications: null, partialBenefit: true,
    groups: [{ key: 'main', role: 'benefit', quantity: 1, unit: '件' }], benefit: { kind: 'percentage', basisPoints: 5000 }, priceBasis: 'catalog' };
  const activity = { id: 'draft', name: 'Catalog trial', status: 'draft', startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-02-01T00:00:00Z',
    priority: 0, ruleVersion: 1, ruleDefinition: definition, products: [] };
  const previewBindings = [{ productId: 'p1', variantId: 'v1', groupKey: 'main', product: { id: 'p1', name: 'Sample', catalogNumber: 'ABC' },
    variant: { id: 'v1', catalogNumber: 'ABC-1', spec: 'small' } }];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? { ok: true, json: async () => ({ previewBindings }) }
    : { ok: true, json: async () => ({ promotions: [activity], actorId: 'admin', unifiedPricingEnabled: true }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<PromotionsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '试算活动' }));
  expect(await screen.findByLabelText('试算数量 ABC-1')).toBeInTheDocument();
  expect(JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as string)).toEqual({ resolveBindings: true });
});

it('preserves an all-variants selector when a benefit change is rejected', async () => {
  const posts: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/products?')) return { ok: true, json: async () => ({ products: [{ id: 'p1', name: 'Sample', catalogNumber: 'ABC', variants: [{ id: 'v1', catalogNumber: 'ABC-1', spec: 'small' }] }] }) };
    if (init?.method === 'POST') { posts.push(init); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ promotions: [], actorId: 'admin' }) };
  }));
  render(<PromotionsPage />);
  fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: 'Sample offer' } });
  fireEvent.change(screen.getByLabelText('规则模板'), { target: { value: 'direct-price' } });
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2030-01-01T00:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2030-01-10T00:00' } });
  fireEvent.change(screen.getByLabelText('优惠方式'), { target: { value: 'percentage' } });
  fireEvent.click(screen.getByLabelText('使用各商品或规格的目录价（暂不可发布）'));
  fireEvent.change(screen.getByLabelText('搜索货号或商品名称'), { target: { value: 'ABC' } });
  fireEvent.click(await screen.findByRole('button', { name: /选择发布时全部规格/ }));
  fireEvent.change(screen.getByLabelText('优惠方式'), { target: { value: 'fixed-price' } });
  expect(screen.getByRole('alert').textContent).toContain('请先移除发布时全部规格的选择');
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(JSON.parse(posts[0].body as string).catalogSelections).toEqual([{ productId: 'p1', allVariants: true, groupKey: 'main' }]);
});

it('keeps a legacy multi-product activity in its original format when editing', async () => {
  const activity = {
    id: 'legacy', name: 'Legacy offer', type: 'discount_rate', value: 0.6,
    status: 'paused', startsAt: '2030-01-01T00:00:12.123Z', endsAt: '2030-01-10T00:00:45.678Z',
    priority: 2, exclusive: 1, ruleVersion: 3, ruleDefinition: null,
    products: [
      { productId: 'p1', variantId: null, groupKey: 'main', product: { id: 'p1', name: 'Product one', catalogNumber: 'A' }, variant: null },
      { productId: 'p2', variantId: 'v2', groupKey: 'main', product: { id: 'p2', name: 'Product two', catalogNumber: 'B' }, variant: { id: 'v2', catalogNumber: 'B-1', spec: 'small' } },
    ],
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return { ok: true, json: async () => init?.method === 'PATCH' ? { promotion: activity } : { promotions: [activity], actorId: 'admin' } };
  }));
  render(<PromotionsPage />);
  await screen.findByText('Legacy offer');
  const record = screen.getByText('Legacy offer').closest('div')!.parentElement!;
  fireEvent.click(within(record).getByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(requests.some((request) => request.init?.method === 'PATCH')).toBe(true));
  const payload = JSON.parse(requests.find((request) => request.init?.method === 'PATCH')!.init!.body as string);
  expect(payload).toMatchObject({ name: 'Renamed', type: 'discount_rate', value: 0.6, ruleDefinition: null,
    expectedVersion: 3, startsAt: activity.startsAt, endsAt: activity.endsAt,
    products: [{ productId: 'p1', variantId: null, groupKey: 'main' }, { productId: 'p2', variantId: 'v2', groupKey: 'main' }] });
  expect(payload).not.toHaveProperty('status');
});

it('reuses the same create key after an uncertain request failure', async () => {
  const posts: Array<RequestInit> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/products?')) return { ok: true, json: async () => ({ products: [{ id: 'p1', name: 'Sample', catalogNumber: 'ABC', variants: [] }] }) };
    if (init?.method === 'POST') {
      posts.push(init);
      if (posts.length === 1) throw new Error('network unavailable');
      return { ok: true, json: async () => ({ promotion: { id: 'new' } }) };
    }
    return { ok: true, json: async () => ({ promotions: [], idempotencyEnabled: true, actorId: 'admin' }) };
  }));
  render(<PromotionsPage />);
  fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: 'Sample offer' } });
  fireEvent.change(screen.getByLabelText('规则模板'), { target: { value: 'direct-price' } });
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2030-01-01T00:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2030-01-10T00:00' } });
  fireEvent.change(screen.getByLabelText('搜索货号或商品名称'), { target: { value: 'ABC' } });
  fireEvent.click(await screen.findByRole('button', { name: /ABC · Sample · 商品本身/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText('network unavailable');
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0].body).toBe(posts[1].body);
  expect((posts[0].headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  expect((posts[0].headers as Record<string, string>)['Idempotency-Key']).toBe((posts[1].headers as Record<string, string>)['Idempotency-Key']);
});

it('never retries an uncertain keyed create without its key after the capability is disabled', async () => {
  let enabled = true;
  const posts: RequestInit[] = [];
  const existing = { id: 'other', name: 'Existing', status: 'draft', startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2030-01-10T00:00:00.000Z', priority: 0, ruleVersion: 1, ruleDefinition: null, products: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/products?')) return { ok: true, json: async () => ({ products: [{ id: 'p1', name: 'Sample', catalogNumber: 'ABC', variants: [] }] }) };
    if (init?.method === 'POST') { posts.push(init); if (posts.length === 1) throw new Error('network unavailable'); return { ok: false, json: async () => ({ error: 'temporarily disabled' }) }; }
    if (init?.method === 'PATCH') { enabled = false; return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ promotions: [existing], idempotencyEnabled: enabled, actorId: 'admin' }) };
  }));
  render(<PromotionsPage />);
  await screen.findByText('Existing');
  fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: 'Sample offer' } });
  fireEvent.change(screen.getByLabelText('规则模板'), { target: { value: 'direct-price' } });
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2030-01-01T00:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2030-01-10T00:00' } });
  fireEvent.change(screen.getByLabelText('搜索货号或商品名称'), { target: { value: 'ABC' } });
  fireEvent.click(await screen.findByRole('button', { name: /ABC · Sample · 商品本身/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText('network unavailable');
  fireEvent.click(screen.getByRole('button', { name: '发布活动' }));
  await screen.findByText('活动状态更新成功');
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText('temporarily disabled');
  expect(posts).toHaveLength(2);
  expect((posts[0].headers as Record<string, string>)['Idempotency-Key']).toBe((posts[1].headers as Record<string, string>)['Idempotency-Key']);
  fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: 'Changed offer' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText('前次创建结果未确认，请先核对该活动后再创建其他活动');
  expect(posts).toHaveLength(2);
});

it('reuses a pending create key after remount when the body is identical', async () => {
  const posts: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/products?')) return { ok: true, json: async () => ({ products: [{ id: 'p1', name: 'Sample', catalogNumber: 'ABC', variants: [] }] }) };
    if (init?.method === 'POST') { posts.push(init); if (posts.length === 1) throw new Error('network unavailable'); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ promotions: [], idempotencyEnabled: true, actorId: 'admin' }) };
  }));
  const fill = async () => {
    fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: 'Sample offer' } });
    fireEvent.change(screen.getByLabelText('规则模板'), { target: { value: 'direct-price' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2030-01-01T00:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2030-01-10T00:00' } });
    fireEvent.change(screen.getByLabelText('搜索货号或商品名称'), { target: { value: 'ABC' } });
    fireEvent.click(await screen.findByRole('button', { name: /ABC · Sample · 商品本身/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  };
  render(<PromotionsPage />); await fill(); await screen.findByText('network unavailable');
  cleanup(); render(<PromotionsPage />); await fill();
  await waitFor(() => expect(posts).toHaveLength(2));
  expect((posts[0].headers as Record<string, string>)['Idempotency-Key']).toBe((posts[1].headers as Record<string, string>)['Idempotency-Key']);
});

it('allows a corrected request after a definitive validation failure', async () => {
  const posts: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/products?')) return { ok: true, json: async () => ({ products: [{ id: 'p1', name: 'Sample', catalogNumber: 'ABC', variants: [] }] }) };
    if (init?.method === 'POST') { posts.push(init); return posts.length === 1
      ? { ok: false, status: 400, json: async () => ({ error: 'invalid dates' }) }
      : { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ promotions: [], idempotencyEnabled: true, actorId: 'admin' }) };
  }));
  render(<PromotionsPage />);
  fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: 'Sample offer' } });
  fireEvent.change(screen.getByLabelText('规则模板'), { target: { value: 'direct-price' } });
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2030-01-01T00:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2030-01-10T00:00' } });
  fireEvent.change(screen.getByLabelText('搜索货号或商品名称'), { target: { value: 'ABC' } });
  fireEvent.click(await screen.findByRole('button', { name: /ABC · Sample · 商品本身/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText('invalid dates');
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2030-01-11T00:00' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect((posts[0].headers as Record<string, string>)['Idempotency-Key']).not.toBe((posts[1].headers as Record<string, string>)['Idempotency-Key']);
});

it('retries the failed search page instead of skipping it', async () => {
  const offsets: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/products?')) {
      const offset = new URL(url, 'http://localhost').searchParams.get('offset')!;
      offsets.push(offset);
      if (offset === '25' && offsets.filter((entry) => entry === '25').length === 1) return { ok: false, json: async () => ({ error: 'page unavailable' }) };
      return { ok: true, json: async () => ({ products: [{ id: `p${offset}`, name: `Sample ${offset}`, catalogNumber: `ABC${offset}`, variants: [] }], hasMore: offset === '0' }) };
    }
    return { ok: true, json: async () => ({ promotions: [], actorId: 'admin' }) };
  }));
  render(<PromotionsPage />);
  fireEvent.change(screen.getByLabelText('搜索货号或商品名称'), { target: { value: 'ABC' } });
  await screen.findByText(/ABC0 · Sample 0/);
  fireEvent.click(screen.getByRole('button', { name: '加载更多商品' }));
  await screen.findByText('page unavailable');
  fireEvent.click(screen.getByRole('button', { name: '重试商品查询' }));
  await screen.findByText(/ABC25 · Sample 25/);
  expect(offsets).toEqual(['0', '25', '25']);
});
