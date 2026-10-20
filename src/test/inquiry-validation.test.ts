import { describe, it, expect } from 'vitest';
import { identityForInquiryFromProfile } from '@/lib/inquiry-validation';

describe('inquiry validation', () => {
  it('keeps legacy and internal profile identities for inquiry storage', () => {
    expect(identityForInquiryFromProfile('资深副教授')).toBe('资深副教授');
    expect(identityForInquiryFromProfile(' 内部员工 ')).toBe('内部员工');
    expect(identityForInquiryFromProfile('研究生')).toBe('研究生');
    expect(identityForInquiryFromProfile('   ')).toBeNull();
  });
});
