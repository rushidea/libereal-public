const INVENTORY_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INVENTORY_QUANTITY: '实际库存必须是整数，且不能小于 -1。',
  INVALID_INBOUND_QUANTITY: '采购在途必须是不小于 0 的整数。',
  INVENTORY_BELOW_RESERVED: '实际库存不能低于已预占数量。',
  INVALID_EXPIRY_DATE: '有效期不正确，请重新选择。',
  INVALID_BATCH_RECEIPT: '请填写批次号，入库数量须为正整数。',
  'productId is required': '缺少产品信息，请重新打开该库存账户。',
  Forbidden: '没有权限查看或修改库存。',
  'Admin MFA required': '请先完成再次确认身份，然后再保存。',
  'Admin authenticator policy required': '请先设置双因素认证，然后再保存。',
  'Session expired': '登录已过期，请重新登录后再试。',
  'Session revoked': '登录已失效，请重新登录后再试。',
};

function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

/** Turn an inventory API error into a user-facing message. Program codes stay off the screen. */
export function inventoryAdminErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'string' || !error.trim() || error === 'Internal server error') return fallback;
  return INVENTORY_ERROR_MESSAGES[error] ?? (hasChinese(error) ? error : fallback);
}
