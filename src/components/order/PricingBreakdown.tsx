import { PRICING_STAGE_LABELS, parsePricingSnapshot } from '@/data/order-pricing';
import { uiSurfaces } from '@/lib/ui-surfaces';

const formatPrice = (price: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

interface PricingBreakdownProps {
  snapshot?: string | null;
  quantity?: number;
  /** 确认订单页使用紧凑模式；活动级优惠在商品行外单独展示。 */
  compact?: boolean;
}

export default function PricingBreakdown({ snapshot, quantity = 1, compact = false }: PricingBreakdownProps) {
  const pricing = parsePricingSnapshot(snapshot);
  if (!pricing) return null;
  const normalizedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const subtotal = pricing.finalPrice * normalizedQuantity;
  const appliedSteps = pricing.steps.filter((step) => step.applied);
  // 若存在已应用的规格价（variant 覆盖基础价），隐藏 base 步骤：
  // base 是「袋装基准价」，对多规格商品属于被覆盖的中间值，展示为当前价格会误导用户
  // （如 BS-1250-T 箱装 340 vs 袋装基准 19.5）。无规格商品不受影响。
  const hasVariantStep = appliedSteps.some((step) => step.stage === 'variant');
  const displaySteps = hasVariantStep
    ? appliedSteps.filter((step) => step.stage !== 'base')
    : appliedSteps;

  if (compact) {
    return (
      <details className={`mt-2 rounded-lg border px-3 py-2 text-xs ${uiSurfaces.border} ${uiSurfaces.panel}`}>
        <summary className={`cursor-pointer list-none font-medium ${uiSurfaces.textSecondary}`}>
          价格明细
        </summary>
        <div className="mt-2 space-y-1.5">
          {displaySteps.map((step, index) => (
            <div key={`${step.stage}-${step.source}-${index}`} className="flex items-start justify-between gap-4 leading-5">
              <span className={`min-w-0 ${uiSurfaces.textSecondary}`}>
                {PRICING_STAGE_LABELS[step.stage]}
              </span>
              <span className={`shrink-0 tabular-nums ${uiSurfaces.titleText}`}>
                {step.stage === 'tier_discount'
                  ? `-${formatPrice(Math.max(step.before - step.after, 0))}`
                  : step.stage === 'variant'
                    ? formatPrice(step.after)
                    : step.before === step.after
                      ? formatPrice(step.after)
                      : `${formatPrice(step.before)} → ${formatPrice(step.after)}`}
              </span>
            </div>
          ))}
          <div className={`flex items-center justify-between gap-4 border-t pt-2 ${uiSurfaces.border}`}>
            <span className={uiSurfaces.textSecondary}>活动前小计</span>
            <span className={`font-medium tabular-nums ${uiSurfaces.titleText}`}>{formatPrice(subtotal)}</span>
          </div>
        </div>
      </details>
    );
  }

  return (
    <div className={`mt-3 rounded-[var(--brand-border-radius)] p-3 ${uiSurfaces.panel}`}>
      <div className="space-y-1.5">
        {displaySteps.map((step, index) => (
          <div key={`${step.stage}-${step.source}-${index}`} className="flex items-start justify-between gap-4 text-sm leading-5">
            <span className={`min-w-0 font-medium ${uiSurfaces.textSecondary}`}>
              {PRICING_STAGE_LABELS[step.stage]}
            </span>
            <span className={`shrink-0 font-semibold tabular-nums ${uiSurfaces.titleText}`}>
              {step.stage === 'tier_discount'
                ? `-${formatPrice(Math.max(step.before - step.after, 0))}`
                : step.stage === 'variant'
                  ? formatPrice(step.after)
                  : step.before === step.after
                    ? formatPrice(step.after)
                    : `${formatPrice(step.before)} → ${formatPrice(step.after)}`}
            </span>
          </div>
        ))}
      </div>
      <div className={`mt-3 space-y-1.5 border-t pt-3 text-sm leading-5 ${uiSurfaces.border}`}>
        <div className="flex items-center justify-end gap-4">
          <span className={`font-semibold tabular-nums ${uiSurfaces.textInteractive}`}>{formatPrice(pricing.finalPrice)}</span>
        </div>
        <div className={`flex items-center justify-between gap-4 ${uiSurfaces.textSecondary}`}>
          <span className="font-medium">数量</span>
          <span className={`font-semibold tabular-nums ${uiSurfaces.titleText}`}>×{normalizedQuantity}</span>
        </div>
        <div className={`flex items-center justify-between gap-4 font-medium ${uiSurfaces.textSecondary}`}>
          <span>小计</span>
          <span className={`font-semibold tabular-nums ${uiSurfaces.titleText}`}>{formatPrice(subtotal)}</span>
        </div>
      </div>
    </div>
  );
}
