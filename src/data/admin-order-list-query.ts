import { alipayPaymentMethodStoredValues } from '@/data/payment-methods';
import { isOrderStatus, ORDER_STATUSES, type OrderStatus } from '@/lib/order-domain';

export const ADMIN_ORDER_LIST_PAGE_SIZE = 20;
export const ADMIN_ORDER_LIST_MAX_PAGE_SIZE = 50;
const MAX_PAGE = 10_000;
const MAX_SEARCH_LENGTH = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type AdminOrderListQuery = {
  page: number;
  pageSize: number;
  search: string;
  status: OrderStatus | '';
  dateFrom: string;
  dateTo: string;
  receivableOpen: boolean;
};

export type AdminOrderListQueryResult =
  | { ok: true; query: AdminOrderListQuery }
  | { ok: false; error: string };

const EMPTY_QUERY: AdminOrderListQuery = {
  page: 1,
  pageSize: ADMIN_ORDER_LIST_PAGE_SIZE,
  search: '',
  status: '',
  dateFrom: '',
  dateTo: '',
  receivableOpen: false,
};

export function parseAdminOrderListQuery(searchParams: URLSearchParams): AdminOrderListQueryResult {
  const status = (searchParams.get('status') || '').trim();
  if (status && !isOrderStatus(status)) {
    return { ok: false, error: '无效的订单状态' };
  }

  const page = parseBoundedInt(searchParams.get('page'), 1, MAX_PAGE, '无效的页码');
  if (typeof page !== 'number') return { ok: false, error: page };
  const pageSize = parseBoundedInt(
    searchParams.get('pageSize'),
    1,
    ADMIN_ORDER_LIST_MAX_PAGE_SIZE,
    '无效的每页数量',
    ADMIN_ORDER_LIST_PAGE_SIZE,
  );
  if (typeof pageSize !== 'number') return { ok: false, error: pageSize };

  const dateFrom = (searchParams.get('dateFrom') || '').trim();
  const dateTo = (searchParams.get('dateTo') || '').trim();
  if (dateFrom && !shanghaiDayStart(dateFrom)) return { ok: false, error: '无效的开始日期' };
  if (dateTo && !shanghaiDayEnd(dateTo)) return { ok: false, error: '无效的结束日期' };

  const search = (searchParams.get('q') ?? searchParams.get('search') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);

  return {
    ok: true,
    query: {
      page,
      pageSize,
      search,
      status: status as OrderStatus | '',
      dateFrom,
      dateTo,
      receivableOpen: searchParams.get('receivable') === 'open',
    },
  };
}

export function toAdminOrderListSearchParams(input: {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  receivableOpen: boolean;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(input.page));
  params.set('pageSize', String(input.pageSize));
  if (input.receivableOpen) params.set('receivable', 'open');
  if (input.status) params.set('status', input.status);
  if (input.search.trim()) params.set('q', input.search.trim());
  if (input.dateFrom) params.set('dateFrom', input.dateFrom);
  if (input.dateTo) params.set('dateTo', input.dateTo);
  return params;
}

/** Inclusive calendar-day bounds in Asia/Shanghai, matching the admin date inputs. */
export function shanghaiDayStart(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function shanghaiDayEnd(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T23:59:59.999+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

type WhereClause = Record<string, unknown>;

/** Pending Alipay orders that have not been paid are shown as 未付款. */
export function pendingUnpaidAlipayWhere(): WhereClause {
  return {
    status: 'pending',
    paidAt: null,
    paymentMethod: { in: alipayPaymentMethodStoredValues() },
  };
}

export function buildAdminActiveOrderWhere(query: AdminOrderListQuery): WhereClause {
  const and: WhereClause[] = [{ archivedAt: null }];
  if (query.receivableOpen) and.push({ receivable: { is: { status: 'open' } } });

  if (query.status === 'unpaid') {
    and.push({ OR: [{ status: 'unpaid' }, pendingUnpaidAlipayWhere()] });
  } else if (query.status === 'pending') {
    and.push({ status: 'pending', NOT: pendingUnpaidAlipayWhere() });
  } else if (query.status) {
    and.push({ status: query.status });
  }

  const createdAt: { gte?: Date; lte?: Date } = {};
  const from = query.dateFrom ? shanghaiDayStart(query.dateFrom) : null;
  const to = query.dateTo ? shanghaiDayEnd(query.dateTo) : null;
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  if (from || to) and.push({ createdAt });

  if (query.search) {
    and.push({
      OR: [
        { id: { contains: query.search } },
        { email: { contains: query.search } },
        { addressSnapshot: { is: { name: { contains: query.search } } } },
        { addressSnapshot: { is: { institution: { contains: query.search } } } },
      ],
    });
  }

  return { AND: and };
}

/** Counts ignore search, date, and status so the status pills stay stable while filtering. */
export function buildAdminActiveOrderCountWhere(receivableOpen: boolean): WhereClause {
  return buildAdminActiveOrderWhere({ ...EMPTY_QUERY, receivableOpen });
}

export function emptyAdminOrderStatusCounts(): Record<OrderStatus, number> {
  return Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
}

export function adminOrderStatusCounts(
  groups: Array<{ status: string; count: number }>,
  pendingAlipayUnpaid: number,
): Record<OrderStatus, number> {
  const counts = emptyAdminOrderStatusCounts();
  for (const group of groups) {
    if (isOrderStatus(group.status)) counts[group.status] += group.count;
  }
  const shift = Math.min(counts.pending, Math.max(0, pendingAlipayUnpaid));
  counts.pending -= shift;
  counts.unpaid += shift;
  return counts;
}

function parseBoundedInt(
  raw: string | null,
  min: number,
  max: number,
  error: string,
  fallback?: number,
): number | string {
  if (raw == null || raw === '') return fallback ?? min;
  if (!/^\d+$/.test(raw)) return error;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return error;
  return parsed;
}
