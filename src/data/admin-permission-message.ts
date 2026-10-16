const PERMISSION_MESSAGES: Record<string, string> = {
  'finance.write': '登记回款、结清、退款或调整授信需要财务权限。',
  'finance.read': '查看授信需要财务权限。',
  'pricing.write': '修改客户等级或折扣需要价格权限。',
  'orders.write': '修改订单状态或发货需要订单处理权限。',
  'customers.write': '修改客户资料需要客户管理权限。',
};

export function adminPermissionErrorMessage(error: unknown, requiredPermission?: unknown): string {
  if (typeof requiredPermission === 'string' && PERMISSION_MESSAGES[requiredPermission]) {
    return PERMISSION_MESSAGES[requiredPermission];
  }
  if (error === 'Forbidden') return '当前账号没有执行该操作的权限。';
  if (typeof error === 'string' && error.trim()) return error;
  return '操作失败';
}
