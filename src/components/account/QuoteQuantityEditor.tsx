'use client';

import { acceptanceQuantityError, draftQuantity, validateAcceptedQuantity } from '@/lib/quote-acceptance';

const formatPrice = (price: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

export function QuoteQuantityEditor({
  quotedQuantity,
  orderedQty,
  minQuantity,
  quantityStep,
  value,
  disabled,
  onChange,
  className,
}: {
  quotedQuantity: number;
  orderedQty: number;
  minQuantity?: number | null;
  quantityStep?: number | null;
  value: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
  className: string;
}) {
  const remaining = Math.max(0, quotedQuantity - orderedQty);
  const minimum = minQuantity && minQuantity > 1 ? minQuantity : 1;
  const step = quantityStep && quantityStep > 1 ? quantityStep : 1;
  const open = remaining > 0;
  const check = validateAcceptedQuantity({
    quotedQuantity,
    orderedQty,
    requested: value,
    minQuantity,
    quantityStep,
  });

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <input
        data-testid="quote-line-quantity"
        type="number"
        inputMode="numeric"
        min={minimum}
        step={step}
        value={value}
        disabled={disabled || !open}
        aria-label="本次接受数量"
        onChange={(event) => {
          event.stopPropagation();
          onChange(draftQuantity(event.target.value));
        }}
        onClick={(event) => event.stopPropagation()}
        className={className}
      />
      <p className="mt-1 text-xs text-gray-500">
        {step > 1 || minimum > 1
          ? `起订 ${minimum}，按 ${step} 的倍数。可以多于报价 ${quotedQuantity}，单价不变。`
          : `可以多于或少于报价 ${quotedQuantity}。按报价单价计。`}
      </p>
      {!check.ok && <p className="mt-1 text-xs text-red-600">{acceptanceQuantityError(check.code)}</p>}
    </div>
  );
}

export function QuoteAcceptancePreview({
  lines,
}: {
  lines: Array<{ name: string; quotedQuantity: number; quantity: number; unitPrice: number }>;
}) {
  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return (
    <div data-testid="quote-acceptance-preview" className="mb-4 space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
      {lines.map((line, index) => (
        <div key={`${line.name}-${index}`} className="flex items-start justify-between gap-3">
          <span className="min-w-0 truncate">{line.name}</span>
          <span className="shrink-0 text-right">报价 {line.quotedQuantity} → 本次 {line.quantity}<br />{formatPrice(line.unitPrice * line.quantity)}</span>
        </div>
      ))}
      {lines.length === 0 && <p>请至少保留一行。</p>}
      <p className="font-semibold">本次金额 {formatPrice(total)}，单价沿用报价</p>
    </div>
  );
}
