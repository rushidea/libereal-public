export type ProfileCreditSaveResult =
  | { status: 'profile_failed'; error: string }
  | { status: 'credit_failed'; error: string }
  | { status: 'ok' };

/**
 * 先保存资料；仅在资料成功后再保存授信，避免资料 4xx 时仍改写授信。
 */
export async function saveUserProfileThenCredit(options: {
  saveProfile: () => Promise<{ ok: boolean; error?: string }>;
  saveCredit: (() => Promise<{ ok: boolean; error?: string }>) | null;
}): Promise<ProfileCreditSaveResult> {
  const profile = await options.saveProfile();
  if (!profile.ok) {
    return { status: 'profile_failed', error: profile.error || '保存失败' };
  }
  if (!options.saveCredit) {
    return { status: 'ok' };
  }
  const credit = await options.saveCredit();
  if (!credit.ok) {
    return {
      status: 'credit_failed',
      error: credit.error
        ? `资料已保存，授信更新失败：${credit.error}`
        : '资料已保存，授信更新失败',
    };
  }
  return { status: 'ok' };
}
