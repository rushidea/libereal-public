import { describe, it, expect } from 'vitest';
import { assertAllowedInquiryIdentity, INQUIRY_ALLOWED_USER_IDENTITIES } from '@/lib/inquiry-validation';

describe('inquiry validation', () => {
  it('accepts known identity values and rejects unknown ones', () => {
    expect(INQUIRY_ALLOWED_USER_IDENTITIES.has('研究生')).toBe(true);
    expect(assertAllowedInquiryIdentity('研究员')).toBe('研究员');
    expect(assertAllowedInquiryIdentity(null)).toBeNull();
    expect(() => assertAllowedInquiryIdentity('不存在身份')).toThrow('INVALID_IDENTITY');
  });
});
