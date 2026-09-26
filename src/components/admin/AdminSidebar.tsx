'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Archive, Receipt, MessageSquare,
  Users, Coins, Tag, Home, ClipboardList, Zap, Package, BookOpen, MoreHorizontal, Scale,
  Warehouse, BadgePercent, ShieldCheck, ListTodo, Megaphone, Newspaper, Building2,
  SlidersHorizontal,
} from 'lucide-react';
import BottomPopup from '@/components/mobile/BottomPopup';
import { uiSurfaces } from '@/lib/ui-surfaces';
import type { AdminPermissionKey } from '@/lib/admin-permissions';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  permission: AdminPermissionKey;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

interface TodoCounts {
  orders: number;
  inquiries: number;
  users: number;
  community: number;
  organizations: number;
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/admin', label: '管理概览', icon: LayoutDashboard, exact: true, permission: 'admin.access' },
    ],
  },
  {
    title: '订单管理',
    items: [
      { href: '/admin/orders', label: '活跃订单', icon: ClipboardList, permission: 'orders.read' },
      { href: '/admin/orders/new', label: '代客下单', icon: Receipt, permission: 'orders.write' },
      { href: '/admin/orders/archived', label: '归档订单', icon: Archive, permission: 'orders.read' },
    ],
  },
  {
    title: '询价管理',
    items: [
      { href: '/admin/inquiries', label: '询价管理', icon: MessageSquare, permission: 'inquiries.read' },
      { href: '/admin/inquiries/archived', label: '归档询价', icon: Archive, permission: 'inquiries.read' },
    ],
  },
  {
    title: '客户管理',
    items: [
      { href: '/admin/users', label: '用户列表', icon: Users, permission: 'customers.read' },
      { href: '/admin/points', label: '积分管理', icon: Coins, permission: 'points.read' },
      { href: '/admin/community', label: '社区共创', icon: BookOpen, permission: 'content.read' },
    ],
  },
  {
    title: '产品管理',
    items: [
      { href: '/admin/products', label: '商品库', icon: Package, permission: 'products.read' },
      { href: '/admin/pricing-adjustments', label: '集中调价', icon: SlidersHorizontal, permission: 'pricing.write' },
      { href: '/admin/inventory', label: '库存与批次', icon: Warehouse, permission: 'inventory.read' },
    ],
  },
  {
    title: '内容与合规',
    items: [
      { href: '/admin/notifications', label: '消息管理', icon: Megaphone, permission: 'content.read' },
      { href: '/admin/wechat-articles', label: '服务号文章', icon: Newspaper, permission: 'content.read' },
      { href: '/admin/legal', label: '文书管理', icon: Scale, permission: 'content.read' },
    ],
  },
  {
    title: '折扣管理',
    items: [
      { href: '/admin/discounts', label: '折扣模板', icon: Tag, permission: 'pricing.read' },
      { href: '/admin/discounts/apply', label: '批量应用', icon: Zap, permission: 'pricing.write' },
      { href: '/admin/promotions', label: '促销活动', icon: BadgePercent, permission: 'pricing.read' },
    ],
  },
  {
    title: '系统管理',
    items: [
      { href: '/admin/organizations', label: '组织审核', icon: Building2, permission: 'organizations.read' },
      { href: '/admin/tasks', label: '任务与通知', icon: ListTodo, permission: 'tasks.read' },
      { href: '/admin/access', label: '权限与审计', icon: ShieldCheck, permission: 'audit.read' },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  // href 带 query（如 /admin/orders?view=receivable）时，用 query 前的路径匹配
  const hrefPath = item.href.split('?')[0];
  if (item.exact) return pathname === hrefPath;
  return pathname === hrefPath || pathname.startsWith(hrefPath + '/');
}

function TodoBadge({ count, compact = false }: { count: number; compact?: boolean }) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-red-500 text-white font-bold leading-none shadow-sm ${
        compact ? 'min-w-4 h-4 px-1 text-[10px]' : 'min-w-5 h-5 px-1.5 text-[11px]'
      }`}
    >
      {label}
    </span>
  );
}

type AdminSidebarProps = {
  collapsed?: boolean;
};

export default function AdminSidebar({ collapsed = false }: AdminSidebarProps) {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [todoCounts, setTodoCounts] = useState<TodoCounts>({ orders: 0, inquiries: 0, users: 0, community: 0, organizations: 0 });
  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => (permissions ? permissions.includes(item.permission) : item.permission === 'admin.access')),
  })).filter((section) => section.items.length > 0);
  const mobileItems = visibleSections.flatMap(section => section.items);
  const preferredMobileHrefs = ['/admin', '/admin/orders', '/admin/inquiries', '/admin/users'];
  const primaryMobileItems = preferredMobileHrefs.map((href) => mobileItems.find((item) => item.href === href)).filter((item): item is NavItem => Boolean(item)).slice(0, 4);
  const primaryHrefs = new Set(primaryMobileItems.map(item => item.href));
  const moreItems = mobileItems.filter(item => !primaryHrefs.has(item.href));
  const moreActive = moreItems.some(item => isActive(pathname, item));
  const badgeByHref = useMemo<Record<string, number>>(() => ({
    '/admin/orders': todoCounts.orders,
    '/admin/inquiries': todoCounts.inquiries,
    '/admin/users': todoCounts.users,
    '/admin/community': todoCounts.community,
    '/admin/organizations': todoCounts.organizations,
  }), [todoCounts]);
  const moreTodoTotal = moreItems.reduce((sum, item) => sum + (badgeByHref[item.href] || 0), 0);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
      if (delta > 6 && y > 100 && !nearBottom) {
        setNavHidden(true);
      } else if (delta < -6 || y <= 100 || nearBottom) {
        setNavHidden(false);
      }
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    // 权限服务不可用时保持 null，侧边栏至少保留「管理概览」入口（见 visibleSections 过滤逻辑）
    fetch('/api/admin/access?view=current').then((response) => response.ok ? response.json() : null).then((data) => setPermissions(data?.permissions || [])).catch(() => setPermissions(null));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTodos() {
      try {
        const res = await fetch('/api/admin/analytics', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const todo = data?.todo;
        if (!todo) return;
        setTodoCounts({
          orders: todo.orders ?? 0,
          inquiries: todo.inquiries ?? 0,
          users: todo.users ?? 0,
          community: todo.community ?? 0,
          organizations: todo.organizations ?? 0,
        });
      } catch {
        if (!cancelled) setTodoCounts({ orders: 0, inquiries: 0, users: 0, community: 0, organizations: 0 });
      }
    }

    fetchTodos();
    const timer = window.setInterval(fetchTodos, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <>
      <aside className={`hidden flex-shrink-0 lg:block ${collapsed ? 'w-16' : 'w-60'}`}>
        <nav className={`${uiSurfaces.panelStrong} sticky top-[calc(var(--site-header-height)+var(--site-header-gap)+0.5rem)] space-y-3 p-3`}>
          {visibleSections.map((section, i) => (
            <div key={i}>
              {section.title && !collapsed && (
                <div className={`px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider ${uiSurfaces.mutedText}`}>
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map(item => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`relative flex items-center rounded-brand text-sm font-medium transition-colors ${uiSurfaces.focusRing} ${
                        active
                          ? 'bg-brand-50 text-brand-700 shadow-none hover:bg-brand-100 dark:bg-brand-100 dark:text-brand-700 dark:hover:bg-brand-200'
                          : `${uiSurfaces.text} hover:bg-[var(--surface-hover)]`
                      } ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2'}`}
                    >
                      <Icon className={`h-4 w-4 flex-shrink-0 ${active ? uiSurfaces.textInteractive : uiSurfaces.mutedText}`} />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {collapsed ? (
                        <span className="absolute translate-x-3 -translate-y-3">
                          <TodoBadge count={badgeByHref[item.href] || 0} compact />
                        </span>
                      ) : (
                        <TodoBadge count={badgeByHref[item.href] || 0} />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="border-t border-[var(--surface-border)] pt-2">
            <Link
              href="/account"
              title={collapsed ? '返回我的账户' : undefined}
              className={`flex items-center rounded-brand text-sm font-medium ${uiSurfaces.mutedText} hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing} ${
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2'
              }`}
            >
              <Home className={`h-4 w-4 ${uiSurfaces.mutedText}`} />
              {!collapsed && '返回我的账户'}
            </Link>
          </div>
        </nav>
      </aside>

      <nav aria-label="移动端管理导航" className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden ${navHidden ? 'hidden' : 'block'} ${uiSurfaces.mobileNav}`}>
        <div className="mx-auto grid w-full max-w-lg grid-cols-5 gap-1 px-2 py-1.5">
          {primaryMobileItems.map(item => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`${uiSurfaces.mobileNavItem} ${active ? uiSurfaces.mobileNavItemActive : ''}`}
              >
                <span className="relative">
                  <Icon className="w-[22px] h-[22px] mb-0.5 pointer-events-none" />
                  <span className="absolute -top-1.5 -right-2">
                    <TodoBadge count={badgeByHref[item.href] || 0} compact />
                  </span>
                </span>
                <span className="max-w-full truncate whitespace-nowrap text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setShowMore(true)}
            aria-expanded={showMore}
            aria-haspopup="dialog"
            className={`${uiSurfaces.mobileNavItem} ${moreActive || showMore ? uiSurfaces.mobileNavItemActive : ''}`}
          >
            <span className="relative">
              <MoreHorizontal className="w-[22px] h-[22px] mb-0.5 pointer-events-none" />
              <span className="absolute -top-1.5 -right-2">
                <TodoBadge count={moreTodoTotal} compact />
              </span>
            </span>
            <span className="max-w-full truncate whitespace-nowrap text-xs font-medium">更多</span>
          </button>
        </div>
      </nav>

      <BottomPopup isOpen={showMore} onClose={() => setShowMore(false)}>
        <div className="max-h-[80dvh] overflow-y-auto px-4 pb-6">
          <div className="mb-3">
            <p className={`text-base font-semibold ${uiSurfaces.titleText}`}>后台管理</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {moreItems.map(item => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowMore(false)}
                  className={`flex items-center gap-2.5 rounded-brand border px-3 py-3 text-sm font-medium transition-colors ${uiSurfaces.focusRing} ${
                    active
                      ? 'bg-brand-50 text-brand-700 shadow-none hover:bg-brand-100 dark:bg-brand-100 dark:text-brand-700 dark:hover:bg-brand-200'
                      : `${uiSurfaces.panel} ${uiSurfaces.text} active:bg-[var(--surface-hover)]`
                  }`}
                >
                  <Icon className={`h-4 w-4 flex-shrink-0 ${active ? uiSurfaces.textInteractive : uiSurfaces.mutedText}`} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <TodoBadge count={badgeByHref[item.href] || 0} />
                </Link>
              );
            })}
            <Link
              href="/account"
              onClick={() => setShowMore(false)}
              className={`flex items-center gap-2.5 rounded-brand border px-3 py-3 text-sm font-medium ${uiSurfaces.panel} ${uiSurfaces.text} active:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}
            >
              <Home className={`h-4 w-4 ${uiSurfaces.mutedText}`} />
              <span>返回账户</span>
            </Link>
          </div>
        </div>
      </BottomPopup>
    </>
  );
}
