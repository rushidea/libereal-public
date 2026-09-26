import { describe, expect, it } from 'vitest';
import { calculateElisaFit, fourPL, type FourPLParameters } from '@/data/calculatorData';

function odFrom(params: FourPLParameters, concentration: number, offset = 0) {
  return Number((fourPL(concentration, params) + offset).toFixed(4));
}

describe('calculateElisaFit', () => {
  const params: FourPLParameters = { a: 0.08, b: -1.25, c: 2.4, d: 2.2 };
  const standards = [0.156, 0.313, 0.625, 1.25, 2.5, 5, 10].map((concentration, index) => ({
    id: `std-${index}`,
    concentration,
    odValues: [odFrom(params, concentration, -0.003), odFrom(params, concentration, 0.003)],
  }));

  it('fits a typical ELISA 4PL curve and back-calculates samples', () => {
    const result = calculateElisaFit(standards, [
      { id: 'sample-1', name: 'Sample 1', odValues: [odFrom(params, 1.8), odFrom(params, 1.8, 0.004)], dilution: 2 },
    ]);

    expect(result.success).toBe(true);
    expect(result.rSquared ?? 0).toBeGreaterThan(0.999);
    expect(result.samples[0].calculatedConcentration ?? 0).toBeGreaterThan(1.6);
    expect(result.samples[0].calculatedConcentration ?? 0).toBeLessThan(2.0);
    expect(result.samples[0].finalConcentration ?? 0).toBeGreaterThan(3.2);
    expect(result.samples[0].finalConcentration ?? 0).toBeLessThan(4.0);
  });

  it('rejects curves with fewer than four valid standards', () => {
    const result = calculateElisaFit(standards.slice(0, 3), []);

    expect(result.success).toBe(false);
    expect(result.message).toContain('至少需要 4 个有效标准点');
  });

  it('flags samples outside the standard range and high replicate CV', () => {
    const result = calculateElisaFit(standards, [
      { id: 'sample-high', name: 'High', odValues: [2.35, 2.42], dilution: 1 },
      { id: 'sample-cv', name: 'CV', odValues: [0.5, 0.9], dilution: 1 },
    ]);

    expect(result.samples[0].finalConcentration).toBeNull();
    expect(result.samples[0].flags.join(' ')).toContain('高于最高标准点');
    expect(result.samples[1].flags.join(' ')).toContain('复孔 CV > 10%');
  });
});
