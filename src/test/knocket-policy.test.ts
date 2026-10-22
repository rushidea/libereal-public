import { describe, expect, it } from 'vitest';
import { shouldLoadKnocket } from '@/lib/knocket-policy';

describe('Knocket route policy', () => {
  it('suppresses the live support widget across public and guarded knowledge routes', () => {
    expect(shouldLoadKnocket('/research/trends')).toBe(false);
    expect(shouldLoadKnocket('/research/trends/trac-engineering-components')).toBe(false);
    expect(shouldLoadKnocket('/research/trends-other')).toBe(true);
  });

  it('keeps the existing widget policy unchanged elsewhere', () => {
    expect(shouldLoadKnocket('/')).toBe(true);
    expect(shouldLoadKnocket('/products/CAS9PL-50UG')).toBe(true);
    expect(shouldLoadKnocket(null)).toBe(true);
  });
});
