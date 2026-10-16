import { isThirdPartyPaymentMethod } from '@/data/payment-methods';

export const ADMIN_PROXY_ORDER_PATH = '/api/admin/orders';

export type AdminProxyOrderItem = {
  productId: string;
  name: string;
  brand: string;
  catalogNumber: string;
  spec: string | null;
  price: number;
  quantity: number;
  shippedQty: 0;
  leadTime: null;
  status: 'pending';
};

export type AdminProxyOrderAddress = {
  id: string;
  name: string;
  phone: string;
  address: string;
  institution: string | null;
};

export type AdminProxyOrderBody = {
  items: AdminProxyOrderItem[];
  paymentMethod: string;
  customerEmail: string;
  platformFee: number;
  transferFee: number;
  addressId?: string;
  addressName?: string;
  addressPhone?: string;
  addressText?: string;
  addressInstitution?: string | null;
};

const ADMIN_MFA_ERRORS = new Set([
  'Admin MFA required',
  'Recent MFA verification required',
  'Admin authenticator policy required',
  '安全验证已失效，请重新验证',
]);

export function proxyOrderServiceFees(paymentMethod: string, subtotal: number) {
  if (!paymentMethod || !isThirdPartyPaymentMethod(paymentMethod)) {
    return { platformFee: 0, transferFee: 0 };
  }
  return {
    platformFee: Math.round(subtotal * 0.02 * 100) / 100,
    transferFee: 20,
  };
}

export function buildAdminProxyOrderBody(input: {
  items: AdminProxyOrderItem[];
  paymentMethod: string;
  customerEmail: string;
  subtotal: number;
  address?: AdminProxyOrderAddress | null;
}): AdminProxyOrderBody {
  const fees = proxyOrderServiceFees(input.paymentMethod, input.subtotal);
  const body: AdminProxyOrderBody = {
    items: input.items,
    paymentMethod: input.paymentMethod,
    customerEmail: input.customerEmail,
    platformFee: fees.platformFee,
    transferFee: fees.transferFee,
  };
  if (input.address) {
    body.addressId = input.address.id;
    body.addressName = input.address.name;
    body.addressPhone = input.address.phone;
    body.addressText = input.address.address;
    body.addressInstitution = input.address.institution;
  }
  return body;
}

export function adminProxyOrderErrorMessage(status: number, error: unknown): string {
  if (status === 403 && typeof error === 'string' && ADMIN_MFA_ERRORS.has(error)) {
    return '此操作需要再次确认身份。请到安全设置完成验证后再下单。';
  }
  if (status === 403) return '没有代客下单权限，请联系管理员开通后再试';
  if (typeof error === 'string' && /[\u4e00-\u9fff]/.test(error)) return error;
  return '创建订单失败，请重试';
}
