/**
 * Customer sidebar unread badges.
 *
 * Maps existing notification rows onto account sidebar modules. Payment success
 * and invoice events do not create notification rows today, so they have no badge.
 *
 * AI Ops permission matrix (not ADMIN_PERMISSION_KEYS):
 * - GET /api/notifications — session. Customers read personal rows for their
 *   email plus broadcasts. Admins read role=admin rows. Anonymous callers get
 *   an empty list. Response adds `unreadByModule` for customer sessions.
 * - PATCH /api/notifications — session. Customers may mark only their own
 *   personal rows and their own broadcast receipts. Body `{ module }` clears
 *   one sidebar module and cannot be combined with `ids` or `markAll`.
 */

export const CUSTOMER_NOTIFICATION_MODULES = [
  'overview',
  'orders',
  'inquiries',
  'points',
  'recipes',
  'notifications',
  'organizations',
] as const;

export type CustomerNotificationModule = (typeof CUSTOMER_NOTIFICATION_MODULES)[number];

export type CustomerNotificationModuleCounts = Record<CustomerNotificationModule, number>;

export const CUSTOMER_NOTIFICATION_MODULE_HREFS: Record<CustomerNotificationModule, string> = {
  overview: '/account',
  orders: '/account/orders',
  inquiries: '/account/inquiries',
  points: '/account/points',
  recipes: '/account?tab=recipes',
  notifications: '/account/notifications',
  organizations: '/account/organizations',
};

export const CUSTOMER_NOTIFICATION_PERMISSIONS = {
  'GET /api/notifications': {
    permission: 'session',
    change: '客户响应增加 unreadByModule，按侧栏模块统计全部未读，不受列表 50 条上限影响。',
  },
  'PATCH /api/notifications': {
    permission: 'session',
    change: '新增 body.module，查看对应模块时只清除该模块未读；不能与 ids 或 markAll 同时使用。',
  },
} as const;

export type CustomerNotificationLike = {
  id?: string;
  type: string;
  title?: string;
  isRead?: boolean;
  linkUrl?: string | null;
  metadata?: string | null;
};

const MODULE_SET = new Set<string>(CUSTOMER_NOTIFICATION_MODULES);

export function emptyCustomerNotificationModuleCounts(): CustomerNotificationModuleCounts {
  return {
    overview: 0,
    orders: 0,
    inquiries: 0,
    points: 0,
    recipes: 0,
    notifications: 0,
    organizations: 0,
  };
}

export function isCustomerNotificationModule(value: string): value is CustomerNotificationModule {
  return MODULE_SET.has(value);
}

export function sumCustomerNotificationModuleCounts(counts: CustomerNotificationModuleCounts): number {
  return CUSTOMER_NOTIFICATION_MODULES.reduce((total, key) => total + counts[key], 0);
}

export function normalizeCustomerNotificationModuleCounts(
  value: Partial<CustomerNotificationModuleCounts> | null | undefined,
): CustomerNotificationModuleCounts {
  const counts = emptyCustomerNotificationModuleCounts();
  if (!value) return counts;
  for (const key of CUSTOMER_NOTIFICATION_MODULES) {
    const count = value[key];
    counts[key] = typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
  return counts;
}

function parseMetadata(metadata?: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const value = JSON.parse(metadata) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function linkIncludes(linkUrl: string | null | undefined, fragment: string): boolean {
  return typeof linkUrl === 'string' && linkUrl.includes(fragment);
}

/**
 * Sidebar module for one notification.
 * `quote_received` is shared by inquiry quotes and order quotes; entity metadata
 * decides the badge. Account-approval rows reuse `order_status_changed` without
 * an order id, so those land on 账户概览.
 */
export function resolveCustomerNotificationModule(
  notification: CustomerNotificationLike,
): CustomerNotificationModule {
  const type = notification.type;
  const metadata = parseMetadata(notification.metadata);
  const linkUrl = notification.linkUrl;

  if (type === 'quote_received') {
    if (metadata.inquiryId || linkIncludes(linkUrl, '/inquiries')) return 'inquiries';
    if (metadata.orderId || linkIncludes(linkUrl, '/orders')) return 'orders';
    return 'inquiries';
  }

  if (
    type === 'quote_expired' ||
    type === 'inquiry_status_updated' ||
    type === 'inquiry_leadtime_updated' ||
    type === 'inquiry_received'
  ) {
    return 'inquiries';
  }

  if (type === 'shipping_notification' || type === 'order_created') return 'orders';

  if (type === 'order_status_changed') {
    if (metadata.orderId || linkIncludes(linkUrl, '/orders')) return 'orders';
    if (metadata.userId || linkUrl === '/account' || linkUrl === '/contact' || linkIncludes(linkUrl, '/contact')) {
      return 'overview';
    }
    return 'orders';
  }

  if (type === 'points_redemption') return 'points';
  if (type === 'account_status_changed' || type === 'approval') return 'overview';
  if (type === 'system') return 'recipes';
  if (type.startsWith('organization_')) return 'organizations';

  // Credit, payables, announcements, and unknown types are readable in 消息中心.
  // There is no customer credit, invoice, or payment sidebar item, and payment
  // success does not create a notification row.
  return 'notifications';
}

export function countUnreadByModule(
  notifications: CustomerNotificationLike[],
): CustomerNotificationModuleCounts {
  const counts = emptyCustomerNotificationModuleCounts();
  for (const notification of notifications) {
    if (notification.isRead) continue;
    counts[resolveCustomerNotificationModule(notification)] += 1;
  }
  return counts;
}

export function dashboardTabNotificationModule(tab: string): CustomerNotificationModule | null {
  if (
    tab === 'overview' ||
    tab === 'orders' ||
    tab === 'inquiries' ||
    tab === 'recipes' ||
    tab === 'notifications'
  ) {
    return tab;
  }
  return null;
}

export function safeNotificationHref(
  linkUrl: string | null | undefined,
  module: CustomerNotificationModule | null,
): string {
  if (linkUrl && linkUrl.startsWith('/') && !linkUrl.startsWith('//')) return linkUrl;
  if (module) return CUSTOMER_NOTIFICATION_MODULE_HREFS[module];
  return CUSTOMER_NOTIFICATION_MODULE_HREFS.notifications;
}

export type NotificationArrivalItem = CustomerNotificationLike & {
  id: string;
  title?: string;
};

export type NotificationArrivalPlan =
  | { kind: 'seed' | 'silent'; seenIds: string[] }
  | { kind: 'summary'; seenIds: string[]; message: string; href: string; count: number };

const SEEN_ID_LIMIT = 400;

function rememberIds(seenIds: string[], unreadIds: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of [...seenIds, ...unreadIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next.slice(-SEEN_ID_LIMIT);
}

/**
 * First snapshot in a tab (no previously seen ids) is recorded without a toast.
 * Later arrivals, including ids that show up after a reload, become one summary.
 */
export function planNotificationArrival(input: {
  initialized: boolean;
  seenIds: string[];
  unread: NotificationArrivalItem[];
}): NotificationArrivalPlan {
  const unreadIds = input.unread.map((item) => item.id);
  const seen = new Set(input.seenIds);
  const fresh = input.unread.filter((item) => item.id && !seen.has(item.id));
  const seenIds = rememberIds(input.seenIds, unreadIds);

  if (!input.initialized && input.seenIds.length === 0) {
    return { kind: 'seed', seenIds };
  }
  if (fresh.length === 0) return { kind: 'silent', seenIds };

  if (fresh.length === 1) {
    const item = fresh[0];
    const moduleName = resolveCustomerNotificationModule(item);
    const title = item.title?.trim();
    return {
      kind: 'summary',
      seenIds,
      count: 1,
      message: title || '您有 1 条新消息',
      href: safeNotificationHref(item.linkUrl, moduleName),
    };
  }

  const modules = new Set(fresh.map((item) => resolveCustomerNotificationModule(item)));
  const onlyModule = modules.size === 1 ? [...modules][0] : null;
  return {
    kind: 'summary',
    seenIds,
    count: fresh.length,
    message: `您有 ${fresh.length} 条新消息`,
    href: onlyModule
      ? CUSTOMER_NOTIFICATION_MODULE_HREFS[onlyModule]
      : CUSTOMER_NOTIFICATION_MODULE_HREFS.notifications,
  };
}

export const CUSTOMER_NOTIFICATION_SEEN_STORAGE_KEY = 'libereal.customerNotification.seenIds';

export function readSeenNotificationIds(storage: Pick<Storage, 'getItem'> | null | undefined): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CUSTOMER_NOTIFICATION_SEEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(-SEEN_ID_LIMIT);
  } catch {
    return [];
  }
}

export function writeSeenNotificationIds(storage: Pick<Storage, 'setItem'> | null | undefined, ids: string[]) {
  if (!storage) return;
  try {
    storage.setItem(CUSTOMER_NOTIFICATION_SEEN_STORAGE_KEY, JSON.stringify(ids.slice(-SEEN_ID_LIMIT)));
  } catch {
    // Private mode and quota failures should not block the inbox.
  }
}
