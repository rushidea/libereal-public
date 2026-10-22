import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clearInquiryDraft,
  INQUIRY_DRAFT_STORAGE_KEY,
  readInquiryDraft,
  writeInquiryDraft,
} from '@/lib/inquiry-draft';

describe('inquiry draft session storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('round-trips draft payload through sessionStorage', () => {
    writeInquiryDraft({
      step: 'form',
      paymentMethod: 'alipay',
      notes: '需要 COA',
      confirmedItems: [{
        name: '试剂',
        brand: 'CST',
        catalogNumber: 'CAT-1',
        quantity: 2,
        unit: '支',
        maxLeadTime: '14',
        itemId: 'item-1',
      }],
    });

    expect(readInquiryDraft()).toMatchObject({
      step: 'form',
      paymentMethod: 'alipay',
      notes: '需要 COA',
    });
    expect(sessionStorage.getItem(INQUIRY_DRAFT_STORAGE_KEY)).toContain('CAT-1');
  });

  it('clears stored draft', () => {
    writeInquiryDraft({ notes: 'x' });
    clearInquiryDraft();
    expect(readInquiryDraft()).toBeNull();
  });
});
