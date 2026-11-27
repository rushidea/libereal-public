/** All prerequisites must be enabled before the unified runtime is usable. */
export function unifiedPromotionRuntimeEnabled(): boolean {
  return process.env.PROMOTION_UNIFIED_ENABLED === 'true'
    && process.env.PROMOTION_FOUNDATION_ENABLED === 'true'
    && process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED === 'true'
    && process.env.PROMOTION_VERSION_CHECK_ENABLED === 'true';
}
