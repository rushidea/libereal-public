import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationHistoryPanel from '@/components/account/OrganizationHistoryPanel';

const historyResponse = {
  organization: { id: 'org-1', name: '测试组织' },
  canReviewOrders: false,
  payableSummary: {
    totalOutstanding: 500,
    maxOverdueDays: 61,
    restriction: 'credit_limited' as const,
    policy: { reminderAfterDays: 30, limitedAfterDays: 60, limitedCreditLimit: 5000, holdAfterDays: 90 },
    checkedAt: '2026-08-09T00:00:00Z',
  },
  orders: [],
  inquiries: [],
  payables: [],
};

describe('OrganizationHistoryPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => historyResponse,
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('默认隐藏应付款规则，触发后使用页面内窗口展示', async () => {
    render(<OrganizationHistoryPanel organizationId="org-1" view="payables" />);

    expect(await screen.findByText('当前组织未结清应付款')).toBeInTheDocument();
    expect(screen.queryByText('超过 30 天未付款，将发送付款提醒。')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看应付款规则' }));

    const dialog = screen.getByRole('dialog', { name: '应付款规则' });
    expect(dialog).toHaveTextContent('超过 30 天未付款，将发送付款提醒。');
    expect(dialog).toHaveTextContent('超过 60 天未付款，下单额度上限为 ¥5,000.00。');
    const dialogCloseButton = screen.getAllByRole('button', { name: '关闭应付款规则窗口' })[1];
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(dialogCloseButton);
    fireEvent.click(screen.getAllByRole('button', { name: '关闭应付款规则窗口' })[1]);
    expect(screen.queryByRole('dialog', { name: '应付款规则' })).not.toBeInTheDocument();
  });

  it('previews the exact version and shows organization review separately from merchant acceptance after reload', async () => {
    const orderId = 'test-org-order';
    const reviewUrl = `/api/organizations/org-1/orders/${orderId}/review`;
    let version = 'test-version-1';
    let approvedVersion: string | undefined;
    let status = 'pending';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/organizations/org-1/history') {
        return Response.json({
          ...historyResponse,
          canReviewOrders: true,
          orders: [{
            id: orderId, status, paymentMethod: 'bank_transfer', subtotal: 50, total: 55,
            createdAt: '2026-08-09T00:00:00Z', archivedAt: null, receivable: null,
            canReview: status === 'pending', hasOrganizationReview: Boolean(approvedVersion),
          }],
        });
      }
      if (url === reviewUrl && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ version });
        approvedVersion = version;
        return Response.json({ orderId, status, organizationReviewed: true, version });
      }
      if (url === reviewUrl) {
        return Response.json({
          orderId, organizationId: 'org-1', version, reviewed: approvedVersion === version,
          total: 55, subtotal: 50, pointsDiscount: 0, paymentMethod: 'bank_transfer',
          recipient: { name: '测试收件人', phone: '00000000000', address: '测试地址' },
          lines: [{ id: 'test-line', name: '合成商品', catalogNumber: 'TEST-SKU', quantity: 1,
            unitPrice: 50, spec: '测试规格', unit: '件', leadTime: '测试货期', conditions: '测试供货条款' }],
          adjustments: [{ id: 'test-fee', label: '测试费用', amount: 5 }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const panel = <OrganizationHistoryPanel organizationId="org-1" view="orders" />;
    const initial = render(panel);
    fireEvent.click(await screen.findByRole('button', { name: '查看组织审核明细' }));
    const preview = within(await screen.findByRole('region', { name: '组织审核明细' }));
    expect(preview.getByText(/收款方 Libereal/)).toBeInTheDocument();
    expect(preview.getByText(/合成商品.*TEST-SKU.*测试规格/)).toBeInTheDocument();
    expect(preview.getByText(/测试收件人.*测试地址/)).toBeInTheDocument();
    expect(preview.getByText(/测试费用/)).toBeInTheDocument();
    expect(preview.getByText(/合计.*55/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(reviewUrl, { cache: 'no-store' });
    fireEvent.click(preview.getByRole('button', { name: '通过组织审核，提交 Libereal 接单' }));

    expect(await screen.findByText('已有组织审核记录，等待 Libereal 接单')).toBeInTheDocument();
    expect(screen.getByText(/待确认$/)).toBeInTheDocument();
    initial.unmount();

    const afterOrganizationApproval = render(panel);
    expect(await screen.findByText('已有组织审核记录，等待 Libereal 接单')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看组织审核明细' }));
    expect(await screen.findByText('本版已通过组织审核')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起明细' }));

    version = 'test-version-2';
    fireEvent.click(screen.getByRole('button', { name: '查看组织审核明细' }));
    expect(await screen.findByRole('button', { name: '通过组织审核，提交 Libereal 接单' })).toBeInTheDocument();
    afterOrganizationApproval.unmount();

    status = 'confirmed';
    render(panel);
    expect(await screen.findByText(/已确认$/)).toBeInTheDocument();
    expect(screen.queryByText('已有组织审核记录，等待 Libereal 接单')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看组织审核明细' })).not.toBeInTheDocument();
  });
});
