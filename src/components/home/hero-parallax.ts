/** Desktop hero drift cap. Images are never parallax targets. */
export const HERO_PARALLAX_MAX_PX = 16;

export const HERO_PARALLAX_DESKTOP_QUERY = '(min-width: 768px)';

export function heroParallaxOffset(distancePx: number, rate: number, allow: boolean) {
  if (!allow || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(distancePx)) return 0;
  return Math.min(HERO_PARALLAX_MAX_PX, Math.max(0, distancePx) * rate);
}
