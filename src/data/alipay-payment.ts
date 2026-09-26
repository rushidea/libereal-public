import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { ALIPAY_PAYABLE_ORDER_STATUSES, isInactiveOrderStatus } from '@/lib/order-domain';

export const ALIPAY_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

type AlipayPayableOrder = {
  createdAt: Date | string;
  paidAt?: Date | string | null;
  paymentMethod?: string | null;
  status?: string | null;
};

export type AlipayPaymentStatus = 'pending' | 'processing' | 'paid' | 'expired' | 'closed' | 'failed';

export type AlipayPaymentSummary = {
  provider: 'alipay';
  status: AlipayPaymentStatus;
  expiresAt: string;
  paidAt: string | null;
  attemptStatus: string | null;
  outTradeNo: string | null;
  tradeNo: string | null;
  notifiedAt: string | null;
};

type AlipayPaymentAttempt = {
  status?: string | null;
  outTradeNo?: string | null;
  tradeNo?: string | null;
  notifiedAt?: Date | string | null;
  paidAt?: Date | string | null;
};

const PAID_ATTEMPT_STATUSES = new Set(['PAID', 'TRADE_SUCCESS', 'TRADE_FINISHED']);
const CLOSED_ATTEMPT_STATUSES = new Set(['CLOSED', 'TRADE_CLOSED', 'CANCELLED']);
const FAILED_ATTEMPT_STATUSES = new Set(['FAILED', 'ERROR', 'PAYMENT_FAILED']);
const PENDING_ATTEMPT_STATUSES = new Set(['CREATED', 'REDIRECTED', 'WAIT_BUYER_PAY']);

function toIsoString(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function getAlipayPaymentExpiresAt(createdAt: Date | string): Date {
  return new Date(new Date(createdAt).getTime() + ALIPAY_PAYMENT_WINDOW_MS);
}

export function formatAlipayTimeExpire(createdAt: Date | string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(getAlipayPaymentExpiresAt(createdAt));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

export function canPayOrderWithAlipay(order: AlipayPayableOrder, now = new Date()): boolean {
  if (normalizeOrderPaymentMethod(order.paymentMethod) !== 'alipay' || order.paidAt) return false;
  if (order.status && !(ALIPAY_PAYABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) return false;
  return now.getTime() < getAlipayPaymentExpiresAt(order.createdAt).getTime();
}

export function getAlipayPaymentSummary(
  order: AlipayPayableOrder,
  attempt?: AlipayPaymentAttempt | null,
  now = new Date(),
): AlipayPaymentSummary | null {
  if (normalizeOrderPaymentMethod(order.paymentMethod) !== 'alipay') return null;

  const attemptStatus = attempt?.status?.trim() || null;
  const normalizedAttemptStatus = attemptStatus?.toUpperCase() || '';
  const paidAt = toIsoString(order.paidAt || attempt?.paidAt);
  let status: AlipayPaymentStatus;

  if (paidAt || PAID_ATTEMPT_STATUSES.has(normalizedAttemptStatus)) {
    status = 'paid';
  } else if (isInactiveOrderStatus(order.status) || CLOSED_ATTEMPT_STATUSES.has(normalizedAttemptStatus)) {
    status = 'closed';
  } else if (FAILED_ATTEMPT_STATUSES.has(normalizedAttemptStatus)) {
    status = 'failed';
  } else if (now.getTime() >= getAlipayPaymentExpiresAt(order.createdAt).getTime()) {
    status = 'expired';
  } else if (attemptStatus && !PENDING_ATTEMPT_STATUSES.has(normalizedAttemptStatus)) {
    status = 'processing';
  } else {
    status = 'pending';
  }

  return {
    provider: 'alipay',
    status,
    expiresAt: getAlipayPaymentExpiresAt(order.createdAt).toISOString(),
    paidAt,
    attemptStatus,
    outTradeNo: attempt?.outTradeNo || null,
    tradeNo: attempt?.tradeNo || null,
    notifiedAt: toIsoString(attempt?.notifiedAt),
  };
}
