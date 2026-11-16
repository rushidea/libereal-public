import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CatalogRepricingReview } from '@/components/admin/CatalogRepricingReview';
import { CatalogRepricingFinance } from '@/components/admin/CatalogRepricingFinance';

const mfa = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('@/components/admin/AdminMfaStepUpDialog', () => ({
  isAdminMfaStepUpResponse: (status: number) => status === 403,
  useAdminMfaStepUp: () => ({ begin: mfa.begin, dialog: null }),
}));
const identity = { inquiryId: 'inquiry-1', quoteId: 'quote-2', orderId: 'order-1', proposalHash: 'proposal-1' };
const quote = { id: identity.quoteId, version: 2, items: [{ name: '测试商品', price: 110, quantity: 2, available: true, leadTime: '90 days', notes: 'Confirmed customer freight',
  metadata: JSON.stringify({ repricingOrderId: identity.orderId, repricingProposalHash: identity.proposalHash,
    previousUnitPrice: 100, previousLeadTime: '7 days', previousNotes: 'Original supply terms', repricingOriginalTotal: 212, repricingProposedTotal: 232,
    repricingPreservedAdjustments: [{ label: '运费', amount: 12 }] }) }] };
function response(body: unknown, status = 200) { return Response.json(body, { status }); }
const preview = { stage: 'awaiting_finance_review', financeApprovalHash: 'a'.repeat(64), blocker: null,
  originalTotal: 212, amounts: { subtotal: 220, adjustmentTotal: 12, total: 232 }, customerEmail: 'fixture@example.com',
  paymentMethod: 'bank', originalPaidAt: null, verifiedPaidAmount: null,
  pointsEvidence: { personal: [], group: [], held: { personal: 0, group: 0 }, recordedNet: { personal: 0, group: 0 } },
  customerResponse: { ownerEmail: 'staff@example.com', responseChannel: '邮件', responseReference: 'fixture reply' },
  adjustments: [{ id: 'fee-1', label: '运费', amount: 12 }], paymentAttempts: [],
  points: { personal: 0, group: 0, discount: 0, applied: false, refundedPersonal: 0, refundedGroup: 0, refundedCash: 0 } };

describe('catalogue repricing human confirmation', () => {
  beforeEach(() => { vi.stubGlobal('confirm', vi.fn(() => true)); mfa.begin.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows a saved customer reply as waiting for finance and submits the complete total', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ result: { ...identity, stage: 'awaiting_finance_review' } }, 202));
    vi.stubGlobal('fetch', fetcher);
    render(<CatalogRepricingReview inquiryId={identity.inquiryId} quote={quote} onRecorded={vi.fn(async () => {})} />);
    expect(screen.getByText('货期：7 days → 90 days')).toBeTruthy();
    expect(screen.getByText('本次供货条件：Confirmed customer freight')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('客户确认记录'), { target: { value: 'fixture response' } });
    fireEvent.click(screen.getByRole('button', { name: '登记客户对金额与供货条件的确认' }));
    await screen.findByText('客户回复已保存，等待财务核对。原订单金额尚未更新。');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ confirmedTotal: 232, proposalHash: identity.proposalHash });
    expect(screen.queryByText('客户确认已登记，原订单价格已更新，等待 Libereal 审核接受。')).toBeNull();
  });

  it('does not show completion for an unknown or mismatched successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ result: { ...identity, stage: 'running' } })));
    const recorded = vi.fn(async () => {});
    render(<CatalogRepricingReview inquiryId={identity.inquiryId} quote={quote} onRecorded={recorded} />);
    fireEvent.change(screen.getByLabelText('客户确认记录'), { target: { value: 'fixture response' } });
    fireEvent.click(screen.getByRole('button', { name: '登记客户对金额与供货条件的确认' }));
    await screen.findByText('返回结果与本次复核不一致，请刷新核对。');
    expect(recorded).not.toHaveBeenCalled();
  });

  it('keeps MFA bound to the displayed finance preview even if another preview is loaded', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ preview }))
      .mockResolvedValueOnce(response({ error: 'Admin MFA required' }, 403))
      .mockResolvedValueOnce(response({ preview: { ...preview, financeApprovalHash: 'b'.repeat(64) } }))
      .mockResolvedValueOnce(response({ code: 'REPRICING_VERSION_CHANGED', error: '内容已变化' }, 409));
    vi.stubGlobal('fetch', fetcher);
    render(<CatalogRepricingFinance {...identity} onRecorded={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole('button', { name: '查看客户回复及财务核对内容' }));
    await screen.findByText('原应付 ¥212.00 → 新应付 ¥232.00');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('财务核对说明'), { target: { value: '原审批说明' } });
    fireEvent.click(screen.getByRole('button', { name: '确认本版金额并更新原订单' }));
    await waitFor(() => expect(mfa.begin).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: '查看客户回复及财务核对内容' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await act(async () => { await mfa.begin.mock.calls[0][0]('test-step-up-token'); });
    await screen.findByText('内容已变化');
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({ financeApprovalHash: 'a'.repeat(64), reason: '原审批说明' });
  });
});
