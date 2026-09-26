import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LegalConsentChecklist from '@/components/legal/LegalConsentChecklist';

describe('LegalConsentChecklist', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        documents: [{
          id: 'site-sales-terms',
          version: '2026-07-17.3',
          title: '销售条款和条件',
          category: 'site',
          kind: 'site',
          description: null,
          sitePath: '/legal/sales-terms',
          downloadUrl: '/legal/sales-terms',
          requireRegister: false,
          requireCheckout: true,
          showOnLegalPage: true,
          showOnOpenPlatform: false,
          sortOrder: 3,
        }],
      }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the reagent return limitation beside the per-order checkbox', async () => {
    render(
      <LegalConsentChecklist
        context="checkout"
        acceptedIds={[]}
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('《销售条款和条件》')).toBeInTheDocument());
    expect(screen.getByText(/勾选即确认理解/)).toHaveTextContent('生活消费用途订单按法律规定处理');
  });
});
