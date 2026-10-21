'use client';

import {
  QUOTE_QUANTITY_KIND_LABEL,
  QUOTE_QUANTITY_NUDGE_THRESHOLDS,
  type QuoteQuantityNudge,
} from '@/lib/quote-quantity-nudge';

export function QuoteQuantityNudgeNotice({ nudges }: { nudges: QuoteQuantityNudge[] }) {
  if (nudges.length === 0) return null;
  return (
    <div
      data-testid="quote-quantity-nudge"
      role="status"
      aria-live="polite"
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
    >
      <p className="font-medium">请核对数量</p>
      <p className="mt-1">
        试剂类单行超过 {QUOTE_QUANTITY_NUDGE_THRESHOLDS.reagent}、耗材类单行超过 {QUOTE_QUANTITY_NUDGE_THRESHOLDS.consumable} 时列在下面。请核对是否填对，核对后可以继续提交。
      </p>
      <ul className="mt-2 space-y-1">
        {nudges.map((nudge) => (
          <li key={nudge.key} data-testid="quote-quantity-nudge-line">
            {nudge.catalogNumber ? `${nudge.catalogNumber} · ` : ''}
            {nudge.name}（{QUOTE_QUANTITY_KIND_LABEL[nudge.kind]}）本次 {nudge.quantity}，超过 {nudge.threshold}
          </li>
        ))}
      </ul>
    </div>
  );
}
