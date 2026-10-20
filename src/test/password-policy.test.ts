import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORD_LENGTH_RANGE_MESSAGE,
  isPasswordMinLength,
  validateNewPasswordLength,
  validateNewPasswordLengthRange,
} from '@/lib/password-policy';

describe('password-policy', () => {
  it('defines minimum length of 8', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('isPasswordMinLength accepts 8+ chars only', () => {
    expect(isPasswordMinLength('')).toBe(false);
    expect(isPasswordMinLength('1234567')).toBe(false);
    expect(isPasswordMinLength('12345678')).toBe(true);
    expect(isPasswordMinLength('long-enough-pass')).toBe(true);
  });

  it('validateNewPasswordLength returns Chinese message for short passwords', () => {
    expect(validateNewPasswordLength('short')).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(validateNewPasswordLength('12345678')).toBeNull();
  });

  it('validateNewPasswordLengthRange enforces max length', () => {
    const tooLong = 'a'.repeat(129);
    expect(validateNewPasswordLengthRange('12345678')).toBeNull();
    expect(validateNewPasswordLengthRange(tooLong)).toBe(PASSWORD_LENGTH_RANGE_MESSAGE);
    expect(validateNewPasswordLengthRange('x')).toBe(PASSWORD_LENGTH_RANGE_MESSAGE);
  });
});
