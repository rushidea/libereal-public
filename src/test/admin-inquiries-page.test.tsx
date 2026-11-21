import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminInquiriesPage from '@/app/admin/inquiries/page';
import ArchivedInquiriesPage from '@/app/admin/inquiries/archived/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'admin', email: 'admin@test.com', role: 'admin' } },
    status: 'authenticated',
  }),
}));

const visibleInquiry = {
  id: 'inq_visible',
  name: '可见客户',
  email: 'visible@test.com',
  phone: '13800000000',
  institution: '甲大学',
  items: [],
  subtotal: 100,
  status: 'pending_quote',
  createdAt: '2026-10-01T08:00:00',
};

const hiddenInquiry = {
  id: 'inq_hidden',
  name: '隐藏客户',
  email: 'hidden@test.com',
  phone: '13900000000',
  institution: '乙大学',
  items: [],
  subtotal: 80,
  status: 'quote_sent',
  createdAt: '2026-09-01T08:00:00',
};

describe('admin inquiries page', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the original repricing inquiry from the pricing result link', async () => {
    window.history.replaceState({}, '', '/admin/inquiries?inquiryId=inq_visible');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{
      ...visibleInquiry, hasUnresolvedPricing: true, activeQuote: {
        id: 'quote-2', version: 2, status: 'draft', catalogRepricing: true,
        items: [{ name: '重算商品', price: 80, quantity: 2, available: true }],
      },
    }, hiddenInquiry] }));
    render(<AdminInquiriesPage />);
    expect(await screen.findByText('重新核算后的待报价明细 · 第 2 版')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认并发送这版重算报价' })).toBeInTheDocument();
  });

  it('refreshes the original draft without sending a quote', async () => {
    window.history.replaceState({}, '', '/admin/inquiries?inquiryId=inq_visible');
    let version = 2;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { version = 3; return Response.json({ result: { status: 'draft', refreshed: true, quoteId: 'quote-3' } }); }
      return Response.json([{ ...visibleInquiry, activeQuote: {
        id: 'quote-' + version, version, status: 'draft', catalogRepricing: true, contentHash: 'hash-' + version,
        items: [{ name: '重算商品', price: 80, quantity: 2, available: true }],
      } }]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: '重新核算并预览' }));
    await screen.findByText('重新核算后的待报价明细 · 第 3 版');
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ refreshCatalogQuote: true, catalogQuoteId: 'quote-2', catalogQuoteHash: 'hash-2' });
  });

  it.each([false, true])('requires the human warning decision (%s) before retrying a draft send', async (acceptWarning) => {
    window.history.replaceState({}, '', '/admin/inquiries?inquiryId=inq_visible');
    vi.stubGlobal('confirm', vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(acceptWarning));
    vi.stubGlobal('alert', vi.fn());
    let writes = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        writes++;
        return writes === 1 ? Response.json({ code: 'COMMERCE_LINE_WARNINGS', warnings: [{ message: '对照价差异需要确认' }] }, { status: 409 }) : Response.json({ success: true });
      }
      return Response.json([{ ...visibleInquiry, activeQuote: { id: 'quote-2', version: 2, status: 'draft',
        catalogRepricing: true, contentHash: 'hash-2', items: [{ name: '重算商品', price: 80, quantity: 2, available: true }] } }]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: '确认并发送这版重算报价' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(writes).toBe(acceptWarning ? 2 : 1));
    if (acceptWarning) await waitFor(() => expect(alert).toHaveBeenCalledWith('重算报价已提交发送'));
    const bodies = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0]).toEqual({ catalogQuoteId: 'quote-2', catalogQuoteHash: 'hash-2', confirmWarnings: false });
    if (acceptWarning) expect(bodies[1]).toEqual({ catalogQuoteId: 'quote-2', catalogQuoteHash: 'hash-2', confirmWarnings: true });
  });

  it('archives only the inquiries visible in the current search', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, count: 1 }) });
      }
      return Promise.resolve({ ok: true, json: async () => [visibleInquiry, hiddenInquiry] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminInquiriesPage />);
    expect(await screen.findByText(/可见客户/)).toBeInTheDocument();
    expect(screen.getByText(/隐藏客户/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选结果' }));
    fireEvent.change(screen.getByPlaceholderText('搜索询价单...'), { target: { value: '可见客户' } });

    expect(screen.queryByText(/隐藏客户/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /批量归档 \(1\)/ }));

    const archiveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(archiveCall?.[0]).toBe('/api/admin/inquiries/archive');
    expect(JSON.parse(String(archiveCall?.[1]?.body))).toEqual({
      inquiryIds: ['inq_visible'],
      action: 'archive',
    });
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });

  it('renders top metadata without duplicate bottom notes, defaults timeline to desc, and flips to asc', async () => {
    const timelineInquiry = {
      ...visibleInquiry,
      id: 'inq_timeline',
      status: 'quote_sent',
      notes: '请加急冷链配送',
      createdAt: '2026-11-01T08:00:00.000Z',
      items: [{ id: 'it_1', name: '抗体 X', brand: 'Abcam', catalogNumber: 'AB-1', quantity: 2, price: 300, customerLeadTime: '5天内' }],
      activeQuote: {
        id: 'q_1',
        version: 1,
        status: 'sent',
        subtotal: 600,
        sentAt: '2026-11-02T09:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', inquiryItemId: 'it_1', name: '抗体 X', price: 300, quantity: 2 }],
      },
      quoteVersions: [{
        id: 'q_1',
        version: 1,
        status: 'sent',
        subtotal: 600,
        sentAt: '2026-11-02T09:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', inquiryItemId: 'it_1', name: '抗体 X', price: 300, quantity: 2 }],
      }],
      feedbackSummary: { totalCount: 1, pendingCount: 1 },
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/feedback')) {
        return Response.json({
          feedbacks: [{
            id: 'fb_1',
            inquiryId: 'inq_timeline',
            quoteId: 'q_1',
            quoteVersion: 1,
            actorType: 'customer',
            actorUserId: 'u_1',
            actorEmail: 'visible@test.com',
            actorName: '可见客户',
            channel: 'website',
            channelReference: null,
            feedbackType: 'price_negotiation',
            content: '希望再优惠一点',
            handlingStatus: 'pending',
            handledByAdminId: null,
            handledByAdminEmail: null,
            handledAt: null,
            resolutionNote: null,
            resolvedByQuoteId: null,
            clientRequestId: null,
            createdAt: '2026-11-03T10:00:00.000Z',
            updatedAt: null,
          }],
        });
      }
      if (url.endsWith('/supplier-quote')) {
        return Response.json({ entries: [] });
      }
      return Response.json([timelineInquiry]);
    }));

    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByTestId('inquiry-row-inq_timeline'));

    const list = await screen.findByTestId('timeline-event-list');
    await waitFor(() => {
      const types = Array.from(list.querySelectorAll('[data-event-type]')).map((el) => el.getAttribute('data-event-type'));
      expect(types).toEqual(['customer_feedback', 'quote_version', 'inquiry_created']);
    });

    // Submit time is rendered once in top header (never duplicated at bottom)
    expect(screen.getAllByText(/提交时间：/)).toHaveLength(1);
    expect(screen.getByText(/备注预览：/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '从早到晚' }));
    const ascTypes = Array.from(list.querySelectorAll('[data-event-type]')).map((el) => el.getAttribute('data-event-type'));
    expect(ascTypes).toEqual(['inquiry_created', 'quote_version', 'customer_feedback']);
  });

  it('filters timeline via stepper steps and category pills and clears when clicked again', async () => {
    const timelineInquiry = {
      ...visibleInquiry,
      id: 'inq_filter',
      status: 'quote_sent',
      createdAt: '2026-11-01T08:00:00.000Z',
      items: [{ id: 'it_1', name: '抗体 X', quantity: 1, price: 300 }],
      activeQuote: {
        id: 'q_1',
        version: 1,
        status: 'sent',
        subtotal: 300,
        sentAt: '2026-11-02T09:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', inquiryItemId: 'it_1', name: '抗体 X', price: 300, quantity: 1 }],
      },
      quoteVersions: [{
        id: 'q_1',
        version: 1,
        status: 'sent',
        subtotal: 300,
        sentAt: '2026-11-02T09:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', inquiryItemId: 'it_1', name: '抗体 X', price: 300, quantity: 1 }],
      }],
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/feedback')) {
        return Response.json({
          feedbacks: [{
            id: 'fb_1',
            inquiryId: 'inq_filter',
            quoteId: 'q_1',
            quoteVersion: 1,
            actorType: 'customer',
            actorUserId: 'u_1',
            actorEmail: 'visible@test.com',
            actorName: '可见客户',
            channel: 'website',
            channelReference: null,
            feedbackType: 'consultation',
            content: '咨询货期',
            handlingStatus: 'pending',
            handledByAdminId: null,
            handledByAdminEmail: null,
            handledAt: null,
            resolutionNote: null,
            resolvedByQuoteId: null,
            clientRequestId: null,
            createdAt: '2026-11-03T10:00:00.000Z',
            updatedAt: null,
          }],
        });
      }
      if (url.endsWith('/supplier-quote')) return Response.json({ entries: [] });
      return Response.json([timelineInquiry]);
    }));

    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByTestId('inquiry-row-inq_filter'));

    const list = await screen.findByTestId('timeline-event-list');
    await waitFor(() => expect(list.querySelectorAll('[data-event-type]')).toHaveLength(3));

    const stepper = screen.getByLabelText('询价进度条');
    const quoteStepBtn = within(stepper).getByRole('button', { name: /报价演进/ });
    fireEvent.click(quoteStepBtn);
    expect(Array.from(list.querySelectorAll('[data-event-type]')).map((el) => el.getAttribute('data-event-type'))).toEqual(['quote_version']);

    fireEvent.click(quoteStepBtn);
    expect(list.querySelectorAll('[data-event-type]')).toHaveLength(3);

    const timelineSection = screen.getByTestId('admin-inquiry-feedback-panel');
    const feedbackPill = within(timelineSection).getByRole('button', { name: '客户反馈' });
    fireEvent.click(feedbackPill);
    expect(Array.from(list.querySelectorAll('[data-event-type]')).map((el) => el.getAttribute('data-event-type'))).toEqual(['customer_feedback']);

    fireEvent.click(feedbackPill);
    expect(list.querySelectorAll('[data-event-type]')).toHaveLength(3);
  });

  it('preserves unsaved price edits when switching mobile tabs', async () => {
    const editableInquiry = {
      ...visibleInquiry,
      id: 'inq_tabs',
      items: [{ id: 'it_1', name: '抗体 Y', quantity: 2, price: 300 }],
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/feedback')) return Response.json({ feedbacks: [] });
      if (url.endsWith('/supplier-quote')) return Response.json({ entries: [] });
      return Response.json([editableInquiry]);
    }));

    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByTestId('inquiry-row-inq_tabs'));
    await screen.findByTestId('timeline-event-list');

    fireEvent.click(screen.getByRole('button', { name: /报价与操作/ }));
    const priceInput = screen.getByLabelText('单价') as HTMLInputElement;
    expect(priceInput.value).toBe('300');

    fireEvent.change(priceInput, { target: { value: '450' } });
    expect(priceInput.value).toBe('450');

    fireEvent.click(screen.getByRole('button', { name: /时间线 \(/ }));
    fireEvent.click(screen.getByRole('button', { name: /报价与操作/ }));

    expect((screen.getByLabelText('单价') as HTMLInputElement).value).toBe('450');
    expect(screen.getByText('¥900.00')).toBeInTheDocument();
  });

  it('resolves pending feedback inline and submits proxy feedback via API', async () => {
    const fbInquiry = {
      ...visibleInquiry,
      id: 'inq_fb_ops',
      status: 'quote_sent',
      items: [{ id: 'it_1', name: '抗体 Z', quantity: 1, price: 200 }],
      activeQuote: {
        id: 'q_sent_1',
        version: 1,
        status: 'sent',
        subtotal: 200,
        sentAt: '2026-11-02T09:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', inquiryItemId: 'it_1', name: '抗体 Z', price: 200, quantity: 1 }],
      },
      quoteVersions: [{
        id: 'q_sent_1',
        version: 1,
        status: 'sent',
        subtotal: 200,
        sentAt: '2026-11-02T09:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', inquiryItemId: 'it_1', name: '抗体 Z', price: 200, quantity: 1 }],
      }],
      feedbackSummary: { totalCount: 1, pendingCount: 1 },
    };

    let feedbacks = [{
      id: 'fb_inline_1',
      inquiryId: 'inq_fb_ops',
      quoteId: 'q_sent_1',
      quoteVersion: 1,
      actorType: 'customer',
      actorUserId: 'u_1',
      actorEmail: 'visible@test.com',
      actorName: '可见客户',
      channel: 'website',
      channelReference: null,
      feedbackType: 'price_negotiation',
      content: '申请九折优惠',
      handlingStatus: 'pending',
      handledByAdminId: null,
      handledByAdminEmail: null,
      handledAt: null,
      resolutionNote: null,
      resolvedByQuoteId: null,
      clientRequestId: null,
      createdAt: '2026-11-03T10:00:00.000Z',
      updatedAt: null,
    }];

    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inquiries/inq_fb_ops/feedback' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        feedbacks = feedbacks.map((fb) => (
          fb.id === body.feedbackId
            ? { ...fb, handlingStatus: body.handlingStatus, resolutionNote: body.resolutionNote }
            : fb
        ));
        return Response.json({ feedback: feedbacks[0] });
      }
      if (url === '/api/inquiries/inq_fb_ops/feedback' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const created = {
          id: 'fb_proxy_2',
          inquiryId: 'inq_fb_ops',
          quoteId: body.quoteId ?? null,
          quoteVersion: body.quoteVersion ?? null,
          actorType: 'admin_proxy',
          actorUserId: 'admin',
          actorEmail: 'admin@test.com',
          actorName: 'admin',
          channel: body.channel,
          channelReference: body.channelReference,
          feedbackType: body.feedbackType,
          content: body.content,
          handlingStatus: 'pending',
          handledByAdminId: null,
          handledByAdminEmail: null,
          handledAt: null,
          resolutionNote: null,
          resolvedByQuoteId: null,
          clientRequestId: body.clientRequestId,
          createdAt: '2026-11-04T10:00:00.000Z',
          updatedAt: null,
        };
        feedbacks = [created, ...feedbacks];
        return Response.json({ feedback: created }, { status: 201 });
      }
      if (url === '/api/inquiries/inq_fb_ops/feedback') {
        return Response.json({ feedbacks });
      }
      if (url === '/api/inquiries/inq_fb_ops/supplier-quote') {
        return Response.json({ entries: [] });
      }
      const pendingCount = feedbacks.filter((f) => f.handlingStatus === 'pending').length;
      return Response.json([{
        ...fbInquiry,
        feedbackSummary: { totalCount: feedbacks.length, pendingCount },
      }]);
    });
    vi.stubGlobal('fetch', fetcher);

    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByTestId('inquiry-row-inq_fb_ops'));

    const card = await screen.findByTestId('feedback-card-fb_inline_1');
    fireEvent.change(within(card).getByLabelText(/内部处理备注/), { target: { value: '已电话沟通确认' } });
    fireEvent.click(within(card).getByRole('button', { name: '标记已处理' }));

    await waitFor(() => {
      const patchCall = fetcher.mock.calls.find(([u, init]) => u === '/api/inquiries/inq_fb_ops/feedback' && init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        feedbackId: 'fb_inline_1',
        handlingStatus: 'resolved',
        resolutionNote: '已电话沟通确认',
        resolvedByQuoteId: null,
      });
    });

    // Submit proxy feedback via Action Workbench card
    fireEvent.click(screen.getByRole('button', { name: /代录外部渠道反馈/ }));
    fireEvent.change(screen.getByLabelText(/来源依据/), { target: { value: '微信聊天 2026-11-20 15:00' } });
    fireEvent.change(screen.getByLabelText(/客户反馈内容/), { target: { value: '客户希望追加 1 盒' } });
    fireEvent.click(screen.getByRole('button', { name: '保存代录反馈' }));

    await waitFor(() => {
      const postCall = fetcher.mock.calls.find(([u, init]) => u === '/api/inquiries/inq_fb_ops/feedback' && init?.method === 'POST');
      expect(postCall).toBeTruthy();
      const headers = postCall?.[1]?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toBeTruthy();
      expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
        channel: 'wechat',
        channelReference: '微信聊天 2026-11-20 15:00',
        feedbackType: 'price_negotiation',
        content: '客户希望追加 1 盒',
        quoteId: 'q_sent_1',
        quoteVersion: 1,
        clientRequestId: headers['Idempotency-Key'],
      });
    });
  });

  it('toggles inquiry row expansion via Enter and Space keys without hijacking nested controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/feedback')) return Response.json({ feedbacks: [] });
      if (url.endsWith('/supplier-quote')) return Response.json({ entries: [] });
      return Response.json([visibleInquiry]);
    }));

    render(<AdminInquiriesPage />);
    const row = await screen.findByTestId('inquiry-row-inq_visible');
    expect(row).toHaveAttribute('role', 'button');
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    await screen.findByTestId('timeline-event-list');

    const checkbox = within(row).getByRole('checkbox', { name: '选择询价单 inq_visible' });
    fireEvent.keyDown(checkbox, { key: ' ' });
    expect(row).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(row, { key: ' ' });
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('preserves unsaved address and notes drafts when paymentMethod is updated', async () => {
    let serverInquiry = {
      ...visibleInquiry,
      id: 'inq_meta_draft',
      address: '原地址',
      notes: '原备注',
      paymentMethod: '',
    };
    let getCount = 0;

    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inquiries/inq_meta_draft' && init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Partial<typeof serverInquiry>;
        serverInquiry = { ...serverInquiry, ...patch };
        return Response.json({ inquiry: serverInquiry });
      }
      if (url.endsWith('/feedback')) return Response.json({ feedbacks: [] });
      if (url.endsWith('/supplier-quote')) return Response.json({ entries: [] });
      getCount += 1;
      return Response.json([serverInquiry]);
    });
    vi.stubGlobal('fetch', fetcher);

    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByTestId('inquiry-row-inq_meta_draft'));
    await screen.findByTestId('timeline-event-list');

    fireEvent.click(screen.getByRole('button', { name: /编辑资料 \/ 付款方式 \/ 地址 \/ 备注/ }));
    const addressInput = screen.getByLabelText('通讯地址') as HTMLInputElement;
    const notesInput = screen.getByLabelText('备注') as HTMLTextAreaElement;
    const paymentSelect = screen.getByLabelText('付款方式') as HTMLSelectElement;

    fireEvent.change(addressInput, { target: { value: '新实验楼 A301' } });
    fireEvent.change(notesInput, { target: { value: '请加急冷链' } });
    fireEvent.change(paymentSelect, { target: { value: '对公转账' } });

    expect(await screen.findByText('付款方式已保存')).toBeInTheDocument();
    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(2));

    expect((screen.getByLabelText('通讯地址') as HTMLInputElement).value).toBe('新实验楼 A301');
    expect((screen.getByLabelText('备注') as HTMLTextAreaElement).value).toBe('请加急冷链');
    expect((screen.getByLabelText('付款方式') as HTMLSelectElement).value).toBe('对公转账');
  });

  it('keeps an ?inquiryId= row collapsed after manual close across subsequent silent refreshes', async () => {
    window.history.replaceState({}, '', '/admin/inquiries?inquiryId=inq_visible');
    let rows = [
      { ...visibleInquiry, paymentMethod: '' },
      { ...hiddenInquiry, paymentMethod: '' },
    ];
    let listFetches = 0;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inquiries/inq_hidden' && init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as { paymentMethod?: string };
        rows = rows.map((row) => (row.id === 'inq_hidden' ? { ...row, ...patch } : row));
        return Response.json({ inquiry: rows[1] });
      }
      if (url === '/api/admin/inquiries/archive' && init?.method === 'PATCH') {
        rows = rows.filter((row) => row.id !== 'inq_hidden');
        return Response.json({ success: true, count: 1 });
      }
      if (url.endsWith('/feedback')) return Response.json({ feedbacks: [] });
      if (url.endsWith('/supplier-quote')) return Response.json({ entries: [] });
      listFetches += 1;
      return Response.json(rows);
    }));

    render(<AdminInquiriesPage />);
    const visibleRow = await screen.findByTestId('inquiry-row-inq_visible');
    expect(visibleRow).toHaveAttribute('aria-expanded', 'true');

    // Manually collapse the ?inquiryId= row
    fireEvent.click(visibleRow);
    expect(visibleRow).toHaveAttribute('aria-expanded', 'false');

    // Expand another row and trigger a silent refresh via metadata update
    const hiddenRow = screen.getByTestId('inquiry-row-inq_hidden');
    fireEvent.click(hiddenRow);
    expect(hiddenRow).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /编辑资料 \/ 付款方式 \/ 地址 \/ 备注/ }));
    fireEvent.change(screen.getByLabelText('付款方式'), { target: { value: '对公转账' } });
    expect(await screen.findByText('付款方式已保存')).toBeInTheDocument();
    await waitFor(() => expect(listFetches).toBe(2));

    expect(screen.getByTestId('inquiry-row-inq_visible')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('inquiry-row-inq_hidden')).toHaveAttribute('aria-expanded', 'true');

    // Archive inq_hidden so selectedInquiry becomes null while fetchData() runs
    fireEvent.click(within(screen.getByTestId('inquiry-row-inq_hidden')).getByRole('button', { name: '归档' }));
    await waitFor(() => expect(listFetches).toBe(3));
    expect(screen.getByTestId('inquiry-row-inq_visible')).toHaveAttribute('aria-expanded', 'false');
  });

  it('safely formats invalid dates and omits orphaned quantity label when read-only', async () => {
    const readOnlyInquiry = {
      ...visibleInquiry,
      id: 'inq_readonly',
      status: 'closed',
      createdAt: 'not-a-valid-date',
      items: [{ id: 'it_ro', name: '封闭商品', quantity: 3, price: 100 }],
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/feedback')) {
        return Response.json({
          feedbacks: [{
            id: 'fb_bad_date',
            inquiryId: 'inq_readonly',
            quoteId: null,
            quoteVersion: null,
            actorType: 'customer',
            actorUserId: 'u_1',
            actorEmail: 'visible@test.com',
            actorName: '可见客户',
            channel: 'website',
            channelReference: null,
            feedbackType: 'consultation',
            content: '测试无效日期兜底',
            handlingStatus: 'pending',
            handledByAdminId: null,
            handledByAdminEmail: null,
            handledAt: null,
            resolutionNote: null,
            resolvedByQuoteId: null,
            clientRequestId: null,
            createdAt: 'not-a-valid-date',
            updatedAt: null,
          }],
        });
      }
      if (url.endsWith('/supplier-quote')) return Response.json({ entries: [] });
      return Response.json([readOnlyInquiry]);
    }));

    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByTestId('inquiry-row-inq_readonly'));
    await screen.findByTestId('feedback-card-fb_bad_date');

    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.getByText('提交时间：—')).toBeInTheDocument();
    expect(screen.queryByLabelText('数量')).not.toBeInTheDocument();
    expect(screen.getByText('数量')).toBeInTheDocument();
  });
});

describe('archived inquiries page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not offer a permanent delete action', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({
        inquiries: [{
          ...visibleInquiry,
          archivedAt: '2026-10-02T08:00:00',
          items: [{ name: '抗体', brand: 'CST', catalogNumber: 'CAT-1', quantity: 1, price: 100 }],
        }],
      }),
    })));

    render(<ArchivedInquiriesPage />);
    const row = await screen.findByText(/可见客户/);
    expect(screen.queryByTitle('永久删除')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();

    fireEvent.click(row.closest('tr') as HTMLElement);
    const detail = await screen.findByText('还原此询价单');
    expect(within(detail.closest('div') as HTMLElement).queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });
});
