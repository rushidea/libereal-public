'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  Beaker,
  Bell,
  Building2,
  Coins,
  FileText,
  FlaskConical,
  Heart,
  Key,
  MapPin,
  Package,
  Shield,
  ShieldCheck,
  Sparkles,
  Ticket,
  User,
} from 'lucide-react';

import { useCustomerNotifications } from '@/context/CustomerNotificationsContext';
import {
  type CustomerNotificationModule,
  type CustomerNotificationModuleCounts,
} from '@/lib/customer-notification-modules';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type AccountTabKey =
  | 'overview'
  | 'orders'
  | 'coupons'
  | 'inquiries'
  | 'wishlist'
  | 'points'
  | 'protocols'
  | 'recipes'
  | 'notifications'
  | 'addresses'
  | 'spectra'
  | 'organizations'
  | 'settings'
  | 'security';

type AccountTab = {
  key: AccountTabKey;
  label: string;
  icon: typeof User;
  rootHref?: string;
  standaloneHref: string;
};

const accountTabs: AccountTab[] = [
  { key: 'overview', label: '账户概览', icon: User, standaloneHref: '/account' },
  { key: 'orders', label: '我的订单', icon: Package, standaloneHref: '/account/orders' },
  { key: 'coupons', label: '我的优惠券', icon: Ticket, rootHref: '/account/coupons', standaloneHref: '/account/coupons' },
  { key: 'inquiries', label: '我的询价', icon: FileText, standaloneHref: '/account/inquiries' },
  { key: 'wishlist', label: '我的收藏', icon: Heart, standaloneHref: '/account?tab=wishlist' },
  { key: 'points', label: '积分商城', icon: Coins, rootHref: '/account/points', standaloneHref: '/account/points' },
  { key: 'protocols', label: '我的实验方案', icon: FlaskConical, standaloneHref: '/account?tab=protocols' },
  { key: 'recipes', label: '我的配方', icon: Beaker, standaloneHref: '/account?tab=recipes' },
  { key: 'notifications', label: '消息中心', icon: Bell, standaloneHref: '/account/notifications' },
  { key: 'addresses', label: '收货地址', icon: MapPin, standaloneHref: '/account/addresses' },
  { key: 'spectra', label: '荧光组合', icon: Sparkles, standaloneHref: '/account?tab=spectra' },
  { key: 'organizations', label: '组织管理', icon: Building2, rootHref: '/account/organizations', standaloneHref: '/account/organizations' },
  { key: 'settings', label: '账户设置', icon: Key, rootHref: '/account/settings', standaloneHref: '/account/settings' },
  { key: 'security', label: '账户安全', icon: ShieldCheck, rootHref: '/account/security', standaloneHref: '/account/security' },
];

const SIDEBAR_NOTIFICATION_MODULE: Partial<Record<AccountTabKey, CustomerNotificationModule>> = {
  overview: 'overview',
  orders: 'orders',
  inquiries: 'inquiries',
  points: 'points',
  recipes: 'recipes',
  notifications: 'notifications',
  organizations: 'organizations',
};

function formatUnreadCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function UnreadBadge({ count, testId }: { count: number; testId: string }) {
  if (count <= 0) return null;
  return (
    <span
      data-testid={testId}
      className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[var(--brand-color-error)] px-1 text-[10px] font-bold leading-none text-[var(--brand-color-text-on-primary)]"
      aria-label={`${count} 条未读`}
    >
      {formatUnreadCount(count)}
    </span>
  );
}

export default function AccountSidebar({
  activeKey,
  onTabChange,
  unreadCounts,
}: {
  activeKey: string;
  onTabChange?: (key: AccountTabKey) => void;
  unreadCounts?: Partial<CustomerNotificationModuleCounts>;
}) {
  const { data: session } = useSession();
  const live = useCustomerNotifications();
  const counts = unreadCounts ?? live.unreadByModule;
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  const itemBaseClass = 'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors';
  const activeClass = 'bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-700';
  const inactiveClass = 'text-gray-600 hover:bg-white/70 hover:text-brand-600 dark:text-slate-600 dark:hover:bg-slate-100/76 dark:hover:text-brand-700';

  return (
    <aside className="w-full flex-shrink-0 lg:w-56">
      <div className={`grid grid-cols-2 gap-1.5 rounded-2xl p-2 sm:gap-2 lg:block lg:space-y-1 ${uiSurfaces.panelStrong}`}>
        {accountTabs.map((tab) => {
          const Icon = tab.icon;
          const className = `${itemBaseClass} ${activeKey === tab.key ? activeClass : inactiveClass} ${tab.key === 'overview' ? 'col-span-2 lg:col-span-1' : ''}`;
          const href = onTabChange ? tab.rootHref : tab.standaloneHref;
          const moduleName = SIDEBAR_NOTIFICATION_MODULE[tab.key];
          const unread = moduleName ? counts[moduleName] ?? 0 : 0;
          const content = (
            <>
              <Icon size={16} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{tab.label}</span>
              <UnreadBadge count={unread} testId={`account-nav-badge-${tab.key}`} />
            </>
          );

          if (href) {
            return (
              <Link key={tab.key} href={href} className={className}>
                {content}
              </Link>
            );
          }

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange?.(tab.key)}
              className={`${className} ${activeKey === tab.key ? '' : 'cursor-pointer'}`}
            >
              {content}
            </button>
          );
        })}
        {isAdmin && (
          <div className="col-span-2 mt-1 border-t border-gray-100 pt-2 dark:border-slate-400 lg:col-span-1">
            <Link
              href="/admin"
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-purple-600 hover:bg-purple-50 dark:text-purple-700 dark:hover:text-purple-900"
            >
              <Shield className="h-4 w-4 text-purple-500" />
              管理控制台
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
