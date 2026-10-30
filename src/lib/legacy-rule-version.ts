import { createHash } from 'node:crypto';
import { canonicalLegacyRule } from '@/lib/cart-promotions/service';
import type { RuleConfig } from '@/lib/cart-promotions/types';

export function legacyRuleVersionHash(rule: RuleConfig): string {
  return createHash('sha256').update(canonicalLegacyRule(rule)).digest('hex');
}

export function legacyRuleCanonicalHash(canonicalConfig: string): string {
  return createHash('sha256').update(canonicalConfig).digest('hex');
}
