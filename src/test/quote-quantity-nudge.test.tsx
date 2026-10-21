import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QuoteConvertPanel from '@/components/account/QuoteConvertPanel';
import { validateAcceptedQuantity } from '@/lib/quote-acceptance';
import { quoteView, type QuoteRecord } from '@/lib/quote-records';
import {
  QUOTE_QUANTITY_KIND_BY_TYPE,
  QUOTE_QUANTITY_NUDGE_THRESHOLDS,
  classifyQuoteQuantityKind,
  findQuoteQuantityNudges,
  type QuoteQuantityTaxonomy,
} from '@/lib/quote-quantity-nudge';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const reagent = { category: '化学试剂', subcategory: '常规化学试剂', type: null };
const consumable = { category: '材料合成', subcategory: '移液与液体处理', type: '移液器吸头' };

function line(key: string, quantity: number, taxonomy: QuoteQuantityTaxonomy, name = key) {
  return { key, name, catalogNumber: key, quantity, ...taxonomy };
}

describe('quote quantity classification', () => {
  it('maps reagent and consumable categories, including antibody and kit reagents', () => {
    expect(QUOTE_QUANTITY_NUDGE_THRESHOLDS).toEqual({ reagent: 10, consumable: 50 });
    expect(classifyQuoteQuantityKind(reagent)).toBe('reagent');
    expect(classifyQuoteQuantityKind({ category: '一抗' })).toBe('reagent');
    expect(classifyQuoteQuantityKind({ category: 'ELISA试剂盒' })).toBe('reagent');
    expect(classifyQuoteQuantityKind({ category: '蛋白和细胞系' })).toBe('reagent');
    expect(classifyQuoteQuantityKind({ category: '抗体偶联试剂盒' })).toBe('reagent');
    expect(classifyQuoteQuantityKind({ category: '细胞生物学', subcategory: '细胞培养试剂' })).toBe('reagent');
    expect(classifyQuoteQuantityKind(consumable)).toBe('consumable');
    expect(classifyQuoteQuantityKind({ category: ' 材料合成 ' })).toBe('consumable');
  });

  it('lets 分子生物学耗材 override its reagent parent category', () => {
    expect(classifyQuoteQuantityKind({
      category: '分子生物学',
      subcategory: '分子生物学耗材',
      type: 'PCR 耗材',
    })).toBe('consumable');
    expect(classifyQuoteQuantityKind({
      category: '分子生物学',
      subcategory: '分子生物学试剂',
    })).toBe('reagent');
  });

  it('does not classify instruments, new products, legacy names, blank taxonomy, or type alone', () => {
    const unclassified: QuoteQuantityTaxonomy[] = [
      { category: '仪器设备', subcategory: '实验室常规仪器', type: '离心机' },
      { category: '新产品' },
      { category: '生化试剂' },
      { category: 'Western Blot' },
      { category: null, subcategory: null, type: null },
      {},
      { type: '离心管' },
      { subcategory: '移液与液体处理', type: '移液器吸头' },
    ];
    for (const input of unclassified) {
      expect(classifyQuoteQuantityKind(input)).toBeNull();
    }
    expect(QUOTE_QUANTITY_KIND_BY_TYPE).toEqual({});
  });
});

describe('quote quantity nudge thresholds', () => {
  it('nudges reagents above 10 and consumables above 50', () => {
    const lines = [
      line('RG-10', 10, reagent, '缓冲液'),
      line('RG-11', 11, reagent, '缓冲液'),
      line('CS-11', 11, consumable, '吸头'),
      line('CS-50', 50, consumable, '吸头'),
      line('CS-51', 51, consumable, '吸头'),
      line('RG-51', 51, { category: '化学试剂' }, '酶'),
      line('IN-99', 99, { category: '仪器设备' }, '离心机'),
      line('XX-99', 99, {}, '未分类'),
      line('SUB-11', 11, { category: '分子生物学', subcategory: '分子生物学耗材' }, 'PCR 管'),
      line('SUB-51', 51, { category: '分子生物学', subcategory: '分子生物学耗材' }, 'PCR 管'),
    ];
    expect(findQuoteQuantityNudges(lines)).toEqual([
      { key: 'RG-11', name: '缓冲液', catalogNumber: 'RG-11', quantity: 11, kind: 'reagent', threshold: 10 },
      { key: 'CS-51', name: '吸头', catalogNumber: 'CS-51', quantity: 51, kind: 'consumable', threshold: 50 },
      { key: 'RG-51', name: '酶', catalogNumber: 'RG-51', quantity: 51, kind: 'reagent', threshold: 10 },
      { key: 'SUB-51', name: 'PCR 管', catalogNumber: 'SUB-51', quantity: 51, kind: 'consumable', threshold: 50 },
    ]);
  });

  it('still accepts those quantities under the quote acceptance rule', () => {
    for (const quantity of [10, 11, 50, 51]) {
      expect(validateAcceptedQuantity({ quotedQuantity: 1, orderedQty: 0, requested: quantity })).toEqual({
        ok: true,
        quantity,
      });
    }
  });
});

describe('quote view taxonomy', () => {
  const quote: QuoteRecord = {
    id: 'q1',
    version: 1,
    status: 'sent',
    subtotal: 10,
    currency: 'CNY',
    validUntil: null,
    sentAt: null,
    acceptedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    items: [
      {
        id: 'qi-1',
        inquiryItemId: null,
        productId: 'prod-reagent',
        catalogNumber: 'RG-1',
        name: 'Buffer',
        unitPrice: 10,
        quantity: 1,
        orderedQty: 0,
        lineTotal: 10,
        leadTime: null,
        available: true,
        notes: null,
      },
      {
        id: 'qi-2',
        inquiryItemId: null,
        productId: null,
        catalogNumber: null,
        name: '自定义',
        unitPrice: 10,
        quantity: 1,
        orderedQty: 0,
        lineTotal: 10,
        leadTime: null,
        available: true,
        notes: null,
      },
    ],
  };

  it('attaches product taxonomy and leaves unknown lines unclassified', () => {
    const view = quoteView(quote, new Map([
      ['prod-reagent', { category: '化学试剂', subcategory: '常规化学试剂', type: null }],
    ]));
    expect(view.items[0]).toMatchObject({ category: '化学试剂', subcategory: '常规化学试剂', type: null });
    expect(view.items[1]).toMatchObject({ category: null, subcategory: null, type: null });
    expect(quoteView(quote).items[0]).toMatchObject({ category: null, subcategory: null, type: null });
  });
});

describe('QuoteConvertPanel quantity nudge', () => {
  afterEach(() => {
    cleanup();
  });

  function panel() {
    return render(
      <QuoteConvertPanel
        inquiryId="inq-1"
        quote={{
          id: 'q1',
          version: 1,
          items: [
            { id: 'reagent', name: 'PBS 缓冲液', catalogNumber: 'RG-1', price: 10, quantity: 1, category: '化学试剂' },
            { id: 'consumable', name: '吸头', catalogNumber: 'CS-1', price: 2, quantity: 1, category: '材料合成' },
            { id: 'instrument', name: '离心机', catalogNumber: 'IN-1', price: 100, quantity: 1, category: '仪器设备' },
            { id: 'blank', name: '未分类', catalogNumber: 'XX-1', price: 3, quantity: 1 },
          ],
        }}
      />,
    );
  }

  function setQuantity(index: number, quantity: number) {
    fireEvent.change(screen.getAllByTestId('quote-line-quantity')[index], { target: { value: String(quantity) } });
  }

  function openPreview() {
    fireEvent.click(screen.getByTestId('quote-convert-submit'));
  }

  it('lists only lines over the reagent and consumable thresholds and still continues', async () => {
    panel();
    setQuantity(0, 10);
    setQuantity(1, 50);
    setQuantity(2, 99);
    setQuantity(3, 99);
    openPreview();
    expect(screen.queryByTestId('quote-quantity-nudge')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    setQuantity(0, 11);
    openPreview();
    expect(screen.getByTestId('quote-quantity-nudge')).toHaveTextContent('RG-1 · PBS 缓冲液（试剂）本次 11，超过 10');
    expect(screen.getByTestId('quote-quantity-nudge')).not.toHaveTextContent('CS-1');
    expect(screen.getByTestId('quote-quantity-nudge')).not.toHaveTextContent('IN-1');
    expect(screen.getByTestId('quote-quantity-nudge')).not.toHaveTextContent('XX-1');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    setQuantity(1, 51);
    openPreview();
    const notice = screen.getByTestId('quote-quantity-nudge');
    expect(notice).toHaveTextContent('RG-1 · PBS 缓冲液（试剂）本次 11，超过 10');
    expect(notice).toHaveTextContent('CS-1 · 吸头（耗材）本次 51，超过 50');
    const proceed = screen.getByRole('button', { name: '确认提交' });
    expect(proceed).toBeEnabled();
    fireEvent.click(proceed);
    expect(await screen.findByRole('dialog', { name: '确认采购协议' })).toBeInTheDocument();
  });
});
