import type { BaseRuleConfig } from './types';

export type PromotionLifecycle = 'active' | 'disabled' | 'expired';

/** 保留现有截止时刻语义：等于截止时刻仍有效，超过后失效。 */
export function getRuleLifecycle(rule: BaseRuleConfig, now: Date = new Date()): PromotionLifecycle {
  if (!rule.enabled) return 'disabled';
  if (rule.validFrom && new Date(rule.validFrom) > now) return 'disabled';
  if (rule.validUntil && new Date(rule.validUntil) < now) return 'expired';
  return 'active';
}
