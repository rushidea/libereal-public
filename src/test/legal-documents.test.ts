import { describe, expect, it } from 'vitest';
import { validateAcceptedLegalIds } from '@/lib/legal-documents';

describe('validateAcceptedLegalIds', () => {
  it('accepts when all required ids are present', () => {
    const result = validateAcceptedLegalIds(['a', 'b'], ['a', 'b']);
    expect(result.ok).toBe(true);
  });

  it('rejects missing ids', () => {
    const result = validateAcceptedLegalIds(['a'], ['a', 'b']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(['b']);
  });

  it('rejects non-array input', () => {
    const result = validateAcceptedLegalIds(null, ['a']);
    expect(result.ok).toBe(false);
  });
});
