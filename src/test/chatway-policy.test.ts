import { describe, expect, it } from 'vitest';
import { shouldLoadChatway } from '@/lib/chatway-policy';

describe('Chatway route policy', () => {
  it('suppresses the live support widget across public and guarded knowledge routes', () => {
    expect(shouldLoadChatway('/research/trends')).toBe(false);
    expect(shouldLoadChatway('/research/trends/trac-engineering-components')).toBe(false);
    expect(shouldLoadChatway('/research/trends-other')).toBe(true);
  });

  it('keeps the existing widget policy unchanged elsewhere', () => {
    expect(shouldLoadChatway('/')).toBe(true);
    expect(shouldLoadChatway('/products/CAS9PL-50UG')).toBe(true);
    expect(shouldLoadChatway(null)).toBe(true);
  });
});
