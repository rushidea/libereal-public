'use client';

import { useState } from 'react';
import { QuoteAcceptancePreview, QuoteQuantityEditor } from '@/components/account/QuoteQuantityEditor';
import { QuoteQuantityNudgeNotice } from '@/components/account/QuoteQuantityNudge';
import LegalConsentModal from '@/components/legal/LegalConsentModal';
import { findQuoteQuantityNudges } from '@/lib/quote-quantity-nudge';

type QuoteLine = {
  id?: string;
  name?: string;
  catalogNumber?: string;
  price?: number;
  quantity?: number;
  available?: boolean | null;
  minQuantity?: number | null;
  quantityStep?: number | null;
  category?: string | null;
  subcategory?: string | null;
  type?: string | null;
};

/**
 * 报价转订单前的数量核对。数量没有上限，超过试剂/耗材阈值只提醒。
 * 真正下单仍走账户询价页的 confirm-items，避免另写一套请求体。
 */
export default function QuoteConvertPanel({
  inquiryId,
  quote,
}: {
  inquiryId: string;
  quote: { id: string; version: number; items: QuoteLine[] };
}) {
  const [quantities, setQuantities] = useState<number[]>(() => quote.items.map((item) => item.quantity || 1));
  const [preview, setPreview] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const lines = quote.items.map((item, index) => ({
    item,
    index,
    quantity: quantities[index] ?? (item.quantity || 1),
  }));
  const quantityNudges = findQuoteQuantityNudges(lines.map((line) => ({
    key: line.item.id || String(line.index),
    name: line.item.name,
    catalogNumber: line.item.catalogNumber,
    quantity: line.quantity,
    category: line.item.category,
    subcategory: line.item.subcategory,
    type: line.item.type,
  })));

  return (
    <div data-inquiry-id={inquiryId} data-quote-id={quote.id} data-quote-version={quote.version}>
      {lines.map((line) => (
        <QuoteQuantityEditor
          key={line.item.id || line.index}
          quotedQuantity={line.item.quantity || 1}
          orderedQty={0}
          minQuantity={line.item.minQuantity}
          quantityStep={line.item.quantityStep}
          value={line.quantity}
          onChange={(quantity) => setQuantities((current) => current.map((value, index) => index === line.index ? quantity : value))}
          className="w-24 rounded border px-2 py-1"
        />
      ))}
      <button type="button" data-testid="quote-convert-submit" onClick={() => setPreview(true)}>
        提交订单
      </button>
      {preview && (
        <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6">
          <h3 className="mb-2 text-lg font-bold text-gray-900">确认提交订单</h3>
          <p className="mb-4 text-sm text-gray-600">请核对本次数量。未列出的行不会生成订单。</p>
          <QuoteQuantityNudgeNotice nudges={quantityNudges} />
          <QuoteAcceptancePreview lines={lines.map((line) => ({
            name: line.item.name || '未知产品',
            quotedQuantity: line.item.quantity || 1,
            quantity: line.quantity,
            unitPrice: line.item.price || 0,
          }))} />
          <button type="button" onClick={() => setPreview(false)}>取消</button>
          <button type="button" onClick={() => { setPreview(false); setLegalOpen(true); }}>确认提交</button>
        </div>
      )}
      <LegalConsentModal
        open={legalOpen}
        onClose={() => setLegalOpen(false)}
        onConfirm={() => setLegalOpen(false)}
      />
    </div>
  );
}
