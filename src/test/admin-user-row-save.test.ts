import { describe, expect, it, vi } from 'vitest';
import { saveUserProfileThenCredit } from '@/lib/admin-user-row-save';

describe('saveUserProfileThenCredit', () => {
  it('does not call credit when profile save fails', async () => {
    const saveCredit = vi.fn(async () => ({ ok: true }));
    const result = await saveUserProfileThenCredit({
      saveProfile: async () => ({ ok: false, error: '邮箱格式无效' }),
      saveCredit,
    });
    expect(result).toEqual({ status: 'profile_failed', error: '邮箱格式无效' });
    expect(saveCredit).not.toHaveBeenCalled();
  });

  it('calls credit only after profile succeeds', async () => {
    const order: string[] = [];
    const result = await saveUserProfileThenCredit({
      saveProfile: async () => {
        order.push('profile');
        return { ok: true };
      },
      saveCredit: async () => {
        order.push('credit');
        return { ok: true };
      },
    });
    expect(order).toEqual(['profile', 'credit']);
    expect(result).toEqual({ status: 'ok' });
  });

  it('reports credit failure after profile success without masking profile save', async () => {
    const result = await saveUserProfileThenCredit({
      saveProfile: async () => ({ ok: true }),
      saveCredit: async () => ({ ok: false, error: '额度无效' }),
    });
    expect(result).toEqual({
      status: 'credit_failed',
      error: '资料已保存，授信更新失败：额度无效',
    });
  });

  it('skips credit when saveCredit is null', async () => {
    const result = await saveUserProfileThenCredit({
      saveProfile: async () => ({ ok: true }),
      saveCredit: null,
    });
    expect(result).toEqual({ status: 'ok' });
  });
});
