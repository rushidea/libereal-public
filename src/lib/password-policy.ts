/** 新设或修改密码时的最小长度（登录校验不限制历史短密码）。 */
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_TOO_SHORT_MESSAGE = `密码长度至少为 ${PASSWORD_MIN_LENGTH} 位`;

export const PASSWORD_LENGTH_RANGE_MESSAGE =
  `密码长度需在 ${PASSWORD_MIN_LENGTH} 到 ${PASSWORD_MAX_LENGTH} 个字符之间`;

export function isPasswordMinLength(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}

/** 返回错误文案；长度合法时返回 null。 */
export function validateNewPasswordLength(password: string): string | null {
  if (!isPasswordMinLength(password)) {
    return PASSWORD_TOO_SHORT_MESSAGE;
  }
  return null;
}

/** 管理端创建内部用户等场景：最小与最大长度。 */
export function validateNewPasswordLengthRange(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return PASSWORD_LENGTH_RANGE_MESSAGE;
  }
  return null;
}
