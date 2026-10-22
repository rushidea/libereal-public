import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeclineQuoteDialog from '@/components/account/DeclineQuoteDialog';

describe('DeclineQuoteDialog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('requires a reason, requires a note for 其他, and submits the selected reason', async () => {
    const onDeclined = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DeclineQuoteDialog
        inquiryId="inq-1"
        quoteId="q1"
        quoteVersion={2}
        onClose={vi.fn()}
        onDeclined={onDeclined}
      />,
    );

    expect(screen.getByRole('dialog', { name: '放弃报价' })).toBeInTheDocument();
    expect(screen.getByText('价格偏高，需要再考虑')).toBeInTheDocument();
    expect(screen.getByText('计划有变')).toBeInTheDocument();
    expect(screen.getByText('其他')).toBeInTheDocument();
    const submit = screen.getByTestId('decline-submit');
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId('decline-reason-other'));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('decline-note'), { target: { value: '改期' } });
    expect(submit).toBeEnabled();

    fireEvent.click(screen.getByTestId('decline-reason-price_high'));
    fireEvent.click(submit);

    await waitFor(() => expect(onDeclined).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/inquiries/inq-1/decline', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reasonCode: 'price_high', note: '改期', quoteId: 'q1' }),
    }));
  });

  it('shows a Chinese fallback when the server returns a non-Chinese error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    }));
    render(
      <DeclineQuoteDialog
        inquiryId="inq-1"
        quoteId="q1"
        onClose={vi.fn()}
        onDeclined={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('decline-reason-plans_changed'));
    fireEvent.click(screen.getByTestId('decline-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('无权操作此询价');
  });

  it('shows the server error when the quote can no longer be declined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: '报价已转为订单，不能再拒绝' }),
    }));
    render(
      <DeclineQuoteDialog
        inquiryId="inq-1"
        quoteId="q1"
        onClose={vi.fn()}
        onDeclined={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('decline-reason-plans_changed'));
    fireEvent.click(screen.getByTestId('decline-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('报价已转为订单，不能再拒绝');
  });
});
