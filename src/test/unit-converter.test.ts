import { describe, expect, it } from 'vitest';
import { convertMolarPerVolume } from '@/data/calculatorData';

describe('convertMolarPerVolume', () => {
  it('converts 5 mM/dL to M/mL', () => {
    const result = convertMolarPerVolume(5, 'mM', 'dL', 'M', 'mL');
    expect(result).toBeCloseTo(5e-5, 10);
  });

  it('converts 1 M/L to mM/mL', () => {
    const result = convertMolarPerVolume(1, 'M', 'L', 'mM', 'mL');
    expect(result).toBeCloseTo(1, 10);
  });

  it('is identity for same compound unit', () => {
    const result = convertMolarPerVolume(12.5, 'μM', 'mL', 'μM', 'mL');
    expect(result).toBeCloseTo(12.5, 10);
  });
});
