import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SupplierQuoteReview } from '@/components/admin/SupplierQuoteReview';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lets staff cite an associated message without copying any terms or submitting the reply', async () => {
  const fetcher = vi.fn(async () => Response.json({ entries: [{
    inquiryItemId: 'line_fixture', name: 'Example line', reviewId: 'review_fixture', status: 'awaiting_human',
    scope: { brand: 'Example Brand', catalogNumber: 'EX-1', quantity: 1, cataloguePrice: 800,
      customerPricing: { finalPrice: 640, steps: [{ reason: 'Example basis' }] } },
    mailReceipts: [{ receiptId: 'receipt_fixture', emailId: 101, sender: 'supplier@example.test' }],
  }] }));
  vi.stubGlobal('fetch', fetcher);
  const onRecorded = vi.fn(async () => undefined);
  render(<SupplierQuoteReview inquiryId="inquiry_fixture" onRecorded={onRecorded} />);
  expect(await screen.findByText('已关联邮件头。请到邮箱核对原信；关联不代表供应商回复已确认。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '引用邮件编号' }));
  expect((screen.getByLabelText('沟通渠道') as HTMLInputElement).value).toBe('邮件');
  expect((screen.getByLabelText('书面回复依据（邮件编号、链接或归档记录）') as HTMLInputElement).value).toBe('Cloud Mail #101');
  expect((screen.getByLabelText('供应商每包报价（元）') as HTMLInputElement).value).toBe('');
  expect(fetcher.mock.calls).toEqual([['/api/inquiries/inquiry_fixture/supplier-quote']]);
  expect(onRecorded).not.toHaveBeenCalled();
});
