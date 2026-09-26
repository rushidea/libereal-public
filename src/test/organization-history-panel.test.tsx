import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
