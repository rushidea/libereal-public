'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bell, Menu, Plus, Search, X, User, ChevronDown, ChevronRight, LogOut, Package, Sun, Moon, Sunset, ArrowLeft, Shield } from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import CartPopover from './CartPopover';
import QuickOrderModal from './QuickOrderModal';
import HeaderSearchField from './HeaderSearchField';
import UserAvatar from './UserAvatar';
import DesktopSiteNavigation from './DesktopSiteNavigation';
import MobileSiteMenu from './mobile/MobileSiteMenu';
import type { SiteNavigationId } from '@/data/site-navigation';
import { uiSurfaces } from '@/lib/ui-surfaces';

const headerMutedText = 'text-[var(--brand-color-text-secondary)] dark:text-[var(--brand-color-header-nav)]';
const headerPrimaryText = 'text-[var(--brand-color-text)] dark:text-[var(--brand-color-header-nav)]';
const headerInteractiveText = 'text-[var(--brand-color-text-interactive)]';
const headerInteractiveHover = 'hover:text-[var(--brand-color-text-interactive-hover)]';
const headerInteractiveActive = 'text-[var(--brand-color-text-interactive-active)]';
const headerIconText = `${headerMutedText} pointer-events-none`;
const headerInteractiveIcon = `${headerInteractiveText} pointer-events-none`;
const headerAction = `cursor-pointer select-none touch-manipulation rounded-[var(--brand-border-radius)] ${uiSurfaces.focusRing} active:bg-[var(--brand-color-bg-active)]`;
const popupSurface = `${uiSurfaces.panelStrong} rounded-[var(--brand-border-radius)] border-[var(--brand-color-border)]`;
const popupSection = 'border-[var(--brand-color-border-secondary)]';
const popupItem = `${uiSurfaces.focusRing} ${headerPrimaryText} hover:bg-[var(--brand-color-bg-hover)] ${headerInteractiveHover}`;
const notificationBadge = 'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-[var(--brand-border-radius-pill)] bg-[var(--brand-color-error)] px-1 text-[10px] font-bold leading-none text-[var(--brand-color-text-on-primary)]';

interface AdaptiveHeaderProps {
  showNav?: boolean;
  onSearch?: (q: string) => void;
  showQuickOrder?: boolean;
  onQuickOrderToggle?: () => void;
  isAdmin?: boolean;
  showProductNav?: boolean;
  productCategories?: Array<{ name: string; sub: Array<{ name: string; child?: string[] }> }>;
  onL1Click?: (index: number) => void;
  onL2Click?: (l1: { name: string; sub: Array<{ name: string; child?: string[] }> }, l2Index: number) => void;
  onL3Click?: (child: string) => void;
  l1Index?: number | null;
  l2Index?: number | null;
  l3Type?: string;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  hoverL2Open?: boolean;
  onHoverL2OpenChange?: (open: boolean) => void;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  linkUrl?: string;
  createdAt: string;
}

export default function AdaptiveHeader({
  showNav = true,
  onSearch,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showQuickOrder = false,
  onQuickOrderToggle,
  isAdmin = false,
  showProductNav = false,
  productCategories = [],
  onL1Click,
  onL2Click,
  onL3Click,
  l1Index = null,
  l2Index = null,
  l3Type = '',
  menuOpen = false,
  onMenuOpenChange,
  hoverL2Open = false,
  onHoverL2OpenChange,
}: AdaptiveHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, mounted, toggleTheme } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifs, setRecentNotifs] = useState<Notification[]>([]);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [showQuickOrderModal, setShowQuickOrderModal] = useState(false);
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false);
  const [isMobileWidth, setIsMobileWidth] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [hoverL3Open, setHoverL3Open] = useState(false);
  const [activeNavId, setActiveNavId] = useState<SiteNavigationId | null>(null);
  const [mobileSiteMenuOpen, setMobileSiteMenuOpen] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);

  // 8/4：header 固定 + 滚动隐藏（仅移动端 <1024px，桌面端始终固定显示）
  // 向下滚动隐藏让内容延伸到顶部，向上滚动/回顶显示
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      if (window.innerWidth >= 1024) {
        setHeaderHidden(false);
        lastY = window.scrollY;
        return;
      }
      const y = window.scrollY;
      const delta = y - lastY;
      if (delta > 6 && y > 120) {
        setHeaderHidden(true);
      } else if (delta < -6 || y <= 120) {
        setHeaderHidden(false);
      }
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const onResize = () => {
      if (window.innerWidth >= 1024) setHeaderHidden(false);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const handleSearch = onSearch ?? ((query: string) => {
    const trimmed = query.trim();
    router.push(trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : '/products');
  });
  const submitSearch = () => handleSearch(searchDraft);

  // Auto-expand search bar on tablet (768px - 1023px)
  useEffect(() => {
    const checkWidth = () => {
      const w = window.innerWidth;
      setIsMobileWidth(w < 768);
      if (w >= 768 && w < 1024) {
        setMobileSearchExpanded(true);
      }
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);
  const [role, setRole] = useState('customer');
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const l2CloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const l3CloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openProductMenu = () => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
    onMenuOpenChange?.(true);
  };

  const closeProductMenu = () => {
    menuCloseTimerRef.current = setTimeout(() => onMenuOpenChange?.(false), 150);
  };

  const openL2Menu = () => {
    if (l2CloseTimerRef.current) {
      clearTimeout(l2CloseTimerRef.current);
      l2CloseTimerRef.current = null;
    }
    onHoverL2OpenChange?.(true);
  };

  const closeL2Menu = () => {
    l2CloseTimerRef.current = setTimeout(() => onHoverL2OpenChange?.(false), 150);
  };

  const openL3Menu = () => {
    if (l3CloseTimerRef.current) clearTimeout(l3CloseTimerRef.current);
    setHoverL3Open(true);
  };

  const closeL3Menu = () => {
    l3CloseTimerRef.current = setTimeout(() => setHoverL3Open(false), 150);
  };

  useEffect(() => {
    return () => {
      if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current);
      if (l2CloseTimerRef.current) clearTimeout(l2CloseTimerRef.current);
      if (l3CloseTimerRef.current) clearTimeout(l3CloseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/auth/role')
      .then(r => r.json())
      .then(data => setRole(data.role ?? 'customer'))
      .catch(() => setRole('customer'));
  }, [session]);

  useEffect(() => {
    if (!session?.user) return;

    let cancelled = false;
    const loadNotifications = async () => {
      try {
        const response = await fetch('/api/notifications', { cache: 'no-store' });
        const data = await response.json();
        if (cancelled) return;
        const notifs: Notification[] = data.notifications || [];
        const unread = notifs.filter((n: Notification) => !n.isRead);
        setUnreadCount(unread.length);
        setRecentNotifs(unread.slice(0, 5));
      } catch {
        // Notification refresh is best effort and must not interrupt page navigation.
      }
    };

    void loadNotifications();
    const timer = window.setInterval(() => { void loadNotifications(); }, 30_000);
    const handleFocus = () => { void loadNotifications(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [session, pathname]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (activeNavId && !target.closest('[data-site-nav]')) {
        setActiveNavId(null);
      }
      if (showUserMenu && userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (showNotifMenu && notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [activeNavId, showUserMenu, showNotifMenu]);

  useEffect(() => {
    if (mobileSearchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [mobileSearchExpanded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveNavId(null);
        setShowUserMenu(false);
        setShowNotifMenu(false);
        setMobileSiteMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const name = session?.user?.name ?? session?.user?.email ?? '用户';
  const themeToggleLabel = !mounted
    ? '切换日夜间模式'
    : theme === 'light'
      ? '当前浅色模式，切换为深色模式'
      : theme === 'dark'
        ? '当前深色模式，切换为跟随系统'
        : '当前跟随系统，切换为浅色模式';
  const handleQuickOrderClick = () => {
    if (onQuickOrderToggle) {
      onQuickOrderToggle();
    } else {
      setShowQuickOrderModal(true);
    }
  };

  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const syncHeight = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty('--site-header-height', `${height}px`);
      }
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(el);
    window.addEventListener('resize', syncHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncHeight);
    };
  }, [showNav, showProductNav, menuOpen, isMobileWidth]);

  return (
    <>
      <header
        ref={headerRef}
        data-fixed-header="true"
        data-header-hidden={headerHidden || undefined}
        className={`overflow-visible border-b border-[var(--brand-color-border)] ${headerHidden ? 'hidden' : 'block'}`}
      >
        <div className="mx-auto max-w-6xl px-2 sm:px-4">
          <div className="relative flex h-14 items-center gap-1 sm:gap-4">
            {isMobileWidth && (
              <button
                type="button"
                onClick={() => setMobileSiteMenuOpen(true)}
                className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center ${headerAction} -webkit-tap-highlight-transparent`}
                aria-label="打开站点导航"
                aria-expanded={mobileSiteMenuOpen}
                aria-controls="mobile-site-menu"
                data-mobile-site-menu-trigger
              >
                <Menu size={20} className={headerInteractiveIcon} />
              </button>
            )}
            <Link href="/" className="min-w-0 max-w-[38vw] shrink sm:max-w-none lg:shrink-0 flex items-center gap-2">
              <Image
                src="/libereal-wordmark.svg"
                alt="LIBEREAL"
                width={191}
                height={30}
                className={isAdmin
                  ? 'h-auto w-24 min-[360px]:w-[120px] object-contain sm:h-[30px] sm:w-auto'
                  : 'h-[22px] w-auto max-w-full object-contain sm:h-[30px]'}
                priority
                suppressHydrationWarning
              />
              {isAdmin && (
                <span className={`inline-flex shrink-0 items-center gap-0.5 px-1.5 text-xs font-medium ${uiSurfaces.badgeInfo}`}>
                  <Shield className="h-3 w-3" /> 管理
                </span>
              )}
            </Link>

            <div
              className={
                mobileSearchExpanded && isMobileWidth
                  ? 'absolute inset-x-0 top-1/2 z-[80] flex -translate-y-1/2 items-center gap-2 bg-[color-mix(in_srgb,var(--brand-color-bg-container)_95%,transparent)] py-1 backdrop-blur dark:bg-[color-mix(in_srgb,var(--brand-color-bg-elevated)_95%,transparent)]'
                  : 'min-w-0 flex-1 flex items-center justify-end gap-0 sm:gap-2 lg:hidden'
              }
            >
              {!mobileSearchExpanded ? (
                <>
                  <button
                    onClick={() => setMobileSearchExpanded(true)}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} -webkit-tap-highlight-transparent`}
                  >
                    <Search size={20} className={headerInteractiveIcon} />
                  </button>
                  <button
                    onClick={toggleTheme}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} -webkit-tap-highlight-transparent`}
                    aria-label={themeToggleLabel}
                    title={themeToggleLabel}
                  >
                    {!mounted ? (
                      <Sunset size={18} className={headerMutedText} />
                    ) : theme === 'light' ? (
                      <Sun size={18} className="text-[var(--brand-color-warning)]" />
                    ) : theme === 'dark' ? (
                      <Moon size={18} className={headerMutedText} />
                    ) : (
                      <Sunset size={18} className="text-[var(--brand-color-warning-text)]" />
                    )}
                  </button>
                  {!isAdmin && (
                    <button
                      onClick={handleQuickOrderClick}
                      className={`flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} active:bg-[var(--brand-color-primary-bg)] -webkit-tap-highlight-transparent`}
                      aria-label="快速下单"
                    >
                      <Plus size={18} className={headerInteractiveIcon} />
                    </button>
                  )}
                  {session?.user && (
                    <Link
                      href="/account/notifications"
                      className={`relative flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} -webkit-tap-highlight-transparent`}
                      aria-label="通知"
                    >
                      <Bell size={18} className={headerIconText} />
                      {unreadCount > 0 && (
                        <span className={notificationBadge}>
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <HeaderSearchField
                    value={searchDraft}
                    onChange={setSearchDraft}
                    onSubmit={submitSearch}
                    onEscape={() => setMobileSearchExpanded(false)}
                    enableSuggestions
                    wrapperClassName={`relative ${isMobileWidth ? 'min-w-0 flex-1' : 'w-64 md:w-80'}`}
                    inputClassName={`w-full pl-10 pr-4 text-sm ${uiSurfaces.input}`}
                    inputRef={searchInputRef}
                    showSearchIcon
                    autoFocus
                  />
                  {!isMobileWidth && !isAdmin && (
                    <button
                      onClick={handleQuickOrderClick}
                      className={`flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} active:bg-[var(--brand-color-primary-bg)] -webkit-tap-highlight-transparent`}
                      aria-label="快速下单"
                    >
                      <Plus size={18} className={headerInteractiveIcon} />
                    </button>
                  )}
                  {!isMobileWidth && (
                    <button
                      onClick={toggleTheme}
                      className={`flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} -webkit-tap-highlight-transparent`}
                      aria-label={themeToggleLabel}
                      title={themeToggleLabel}
                    >
                      {!mounted ? (
                        <Sunset size={18} className={headerMutedText} />
                      ) : theme === 'light' ? (
                        <Sun size={18} className="text-[var(--brand-color-warning)]" />
                      ) : theme === 'dark' ? (
                        <Moon size={18} className={headerMutedText} />
                      ) : (
                        <Sunset size={18} className="text-[var(--brand-color-warning-text)]" />
                      )}
                    </button>
                  )}
                  {!isMobileWidth && session?.user && (
                    <Link
                      href="/account/notifications"
                      className={`relative flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} -webkit-tap-highlight-transparent`}
                      aria-label="通知"
                    >
                      <Bell size={18} className={headerIconText} />
                      {unreadCount > 0 && (
                        <span className={notificationBadge}>
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </Link>
                  )}
                  <button
                    onClick={() => setMobileSearchExpanded(false)}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center ${headerAction} -webkit-tap-highlight-transparent`}
                  >
                    <X size={20} className={headerIconText} />
                  </button>
                </>
              )}
            </div>

            <div className="hidden lg:flex flex-1 justify-center px-4">
              <HeaderSearchField
                value={searchDraft}
                onChange={setSearchDraft}
                onSubmit={submitSearch}
                enableSuggestions
                wrapperClassName="relative w-full max-w-md"
                inputClassName={`w-full h-9 px-4 text-sm ${uiSurfaces.inputCompact}`}
              />
            </div>

            <div className="hidden lg:flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={themeToggleLabel}
                title={themeToggleLabel}
                className={`flex h-9 w-9 items-center justify-center rounded-[var(--brand-border-radius)] transition-colors hover:bg-[var(--brand-color-bg-hover)] ${headerAction}`}
              >
                {!mounted ? (
                  <Sunset size={18} className={headerMutedText} />
                ) : theme === 'light' ? (
                  <Sun size={18} className="text-[var(--brand-color-warning)]" />
                ) : theme === 'dark' ? (
                  <Moon size={18} className={headerMutedText} />
                ) : (
                  <Sunset size={18} className="text-[var(--brand-color-warning-text)]" />
                )}
              </button>

              {session?.user && (
                <div className="relative" ref={notifRef}>
                  <button
                    onClick={() => setShowNotifMenu(v => !v)}
                    className={`relative rounded-[var(--brand-border-radius)] p-1.5 transition-colors hover:bg-[var(--brand-color-bg-hover)] ${uiSurfaces.focusRing}`}
                    title="消息中心"
                  >
                    <Bell size={18} className={headerIconText} />
                    {unreadCount > 0 && (
                      <span className={notificationBadge}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifMenu && (
                    <div data-header-popup className={`absolute right-0 top-full z-[100] mt-2 w-80 overflow-hidden ${popupSurface}`}>
                      <div data-header-popup-section className={`flex items-center justify-between border-b px-4 py-3 ${popupSection}`}>
                        <p className={`text-sm font-semibold ${headerPrimaryText}`}>未读消息</p>
                        <Link href="/account/notifications" onClick={() => setShowNotifMenu(false)} className={`text-xs font-medium ${headerInteractiveText} ${headerInteractiveHover} ${uiSurfaces.focusRing}`}>
                          查看全部
                        </Link>
                      </div>
                      {recentNotifs.length === 0 ? (
                        <div data-header-popup-body className={`px-4 py-8 text-center text-sm ${uiSurfaces.mutedText}`}>暂无未读消息</div>
                      ) : (
                        <div data-header-popup-body className="py-1 max-h-80 overflow-y-auto">
                          {recentNotifs.map((n: Notification) => (
                            <Link
                              key={n.id}
                              href={n.linkUrl || '/account/notifications'}
                              onClick={() => setShowNotifMenu(false)}
                              className={`flex items-start gap-3 border-b px-4 py-3 transition-colors last:border-0 ${popupSection} ${popupItem}`}
                            >
                              <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-[var(--brand-border-radius-pill)] bg-[var(--brand-color-error)]" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{n.title}</p>
                                <p className={`mt-0.5 truncate text-xs ${uiSurfaces.mutedText}`}>{n.content}</p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {session?.user ? (
                <div className="relative" ref={userRef}>
                  <button
                    onClick={() => { setShowUserMenu(v => !v); setShowNotifMenu(false); }}
                    className={`flex h-9 items-center gap-2 rounded-[var(--brand-border-radius)] px-2 transition-colors hover:bg-[var(--brand-color-bg-hover)] ${uiSurfaces.focusRing}`}
                  >
                    <UserAvatar src={session.user.image} name={name} />
                    <span className={`max-w-[120px] truncate text-sm font-medium ${headerPrimaryText}`}>
                      {name}
                    </span>
                    <ChevronDown className={`h-4 w-4 ${headerMutedText}`} />
                  </button>

                  {showUserMenu && (
                    <div data-header-popup className={`absolute right-0 top-full z-[210] mt-2 w-52 overflow-hidden ${popupSurface}`}>
                      <div data-header-popup-section className={`border-b px-4 py-3 ${popupSection}`}>
                        <p className={`truncate text-sm font-semibold ${headerPrimaryText}`}>{name}</p>
                        <p className={`mt-0.5 truncate text-xs ${uiSurfaces.mutedText}`}>{session.user.email}</p>
                      </div>
                      <div data-header-popup-body className="py-1">
                        <Link href="/account/orders" onClick={() => setShowUserMenu(false)} className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${popupItem}`}>
                          <Package className={`h-4 w-4 ${headerMutedText}`} /> 我的订单
                        </Link>
                        <Link href="/account" onClick={() => setShowUserMenu(false)} className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${popupItem}`}>
                          <User className={`h-4 w-4 ${headerMutedText}`} /> 我的账户
                        </Link>
                        {role === 'admin' && (
                          <Link href="/admin" onClick={() => setShowUserMenu(false)} className={`flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors ${popupItem}`}>
                            <Shield className={`h-4 w-4 ${headerMutedText}`} /> 管理后台
                          </Link>
                        )}
                        <button onClick={() => signOut({ callbackUrl: '/' })} className={`flex w-full items-center justify-start gap-2.5 px-4 py-2.5 text-left text-sm transition-colors ${uiSurfaces.buttonDanger} !min-h-0 !justify-start !border-0 !bg-transparent !px-4 !py-2.5 !shadow-none hover:!bg-[var(--brand-color-error-bg)]`}>
                          <LogOut className={`h-4 w-4 ${headerMutedText}`} /> 退出登录
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href="/login" className={`text-sm font-medium transition-colors ${headerInteractiveText} ${headerInteractiveHover} ${uiSurfaces.focusRing}`}>登录</Link>
                  <Link href="/register" className={`${uiSurfaces.buttonPrimary} !min-h-0 h-9 px-4 text-sm`}>注册</Link>
                </div>
              )}

              {!isAdmin && (
                <button
                  onClick={handleQuickOrderClick}
                  className={`${uiSurfaces.buttonSecondary} !min-h-0 h-9 px-3 text-sm`}
                >
                  <Plus size={15} /> 快速下单
                </button>
              )}

              <CartPopover />
            </div>
          </div>

          {showNav && (
            <DesktopSiteNavigation
              activeNavId={activeNavId}
              onActiveNavChange={setActiveNavId}
              onQuickOrder={handleQuickOrderClick}
            />
          )}

          {showProductNav && productCategories.length > 0 && (
            <div id="products-nav" className="hidden border-t border-[var(--brand-color-primary-border)] lg:block">
              <div className="max-w-6xl mx-auto px-4 flex items-center flex-wrap py-1.5 gap-x-3 gap-y-1">
              <Link href="/" className={`flex flex-shrink-0 items-center gap-1.5 text-sm ${headerMutedText} ${headerInteractiveHover} ${uiSurfaces.focusRing}`}>
                <ArrowLeft size={14} /> 返回主页
              </Link>

              <span className={uiSurfaces.mutedText}>—</span>

              <div
                className="relative flex-shrink-0"
                onMouseEnter={openProductMenu}
                onMouseLeave={closeProductMenu}
              >
                <Link href="/products" className={`flex items-center gap-1 rounded-[var(--brand-border-radius)] px-2 py-1 text-sm font-medium ${headerInteractiveText} ${headerInteractiveHover} hover:bg-[var(--brand-color-primary-bg)] ${uiSurfaces.focusRing}`}>
                  产品中心
                  <ChevronDown size={14} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </Link>
                <div
                  data-nav-dropdown
                  data-nav-open={menuOpen ? 'true' : 'false'}
                  className={`absolute top-full left-0 pt-1 z-[70] transition-all duration-200 ${menuOpen ? 'opacity-100 visible pointer-events-auto' : 'opacity-0 invisible pointer-events-none'}`}
                >
                  <div data-header-popup className={`max-h-[calc(100vh-8rem)] w-48 overflow-y-auto py-2 ${popupSurface}`}>
                    {productCategories.map((c, i) => (
                      <button key={c.name} onClick={() => onL1Click?.(i)}
                        className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${popupItem}`}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {l1Index !== null && productCategories[l1Index] && (
                <>
                  <span className={uiSurfaces.mutedText}>—</span>
                  <div
                    className="relative flex-shrink-0"
                    onMouseEnter={openL2Menu}
                    onMouseLeave={closeL2Menu}
                  >
                    <Link href={`/products?cat=${encodeURIComponent(productCategories[l1Index].name)}`}
                      className={`flex items-center gap-1 rounded-[var(--brand-border-radius)] px-2 py-1 text-sm font-medium ${headerInteractiveText} ${headerInteractiveHover} hover:bg-[var(--brand-color-primary-bg)] ${uiSurfaces.focusRing}`}>
                      {productCategories[l1Index].name}
                      {productCategories[l1Index].sub.length > 0 && <ChevronDown size={14} className={`transition-transform ${hoverL2Open ? 'rotate-180' : ''}`} />}
                    </Link>
                    {productCategories[l1Index].sub.length > 0 && (
                      <div
                        data-nav-submenu
                        data-nav-open={hoverL2Open ? 'true' : 'false'}
                        className={`absolute top-full left-0 pt-1 z-[70] transition-all duration-200 ${hoverL2Open ? 'opacity-100 visible pointer-events-auto' : 'opacity-0 invisible pointer-events-none'}`}
                      >
                        <div data-header-popup className={`max-h-[calc(100vh-8rem)] w-56 overflow-y-auto py-2 ${popupSurface}`}>
                          {productCategories[l1Index].sub.map((s, j) => (
                            <button key={s.name} onClick={() => onL2Click?.(productCategories[l1Index], j)}
                              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${popupItem}`}>
                              {s.name}
                              {s.child && <ChevronRight size={12} className={headerMutedText} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {l2Index !== null && productCategories[l1Index ?? 0]?.sub[l2Index] && (() => {
                const l2Item = productCategories[l1Index ?? 0].sub[l2Index];
                const l1Name = productCategories[l1Index ?? 0].name;
                return (
                  <>
                    <span className={uiSurfaces.mutedText}>—</span>
                    <div
                      className="relative flex-shrink-0"
                      onMouseEnter={openL3Menu}
                      onMouseLeave={closeL3Menu}
                    >
                      <Link href={`/products?cat=${encodeURIComponent(l1Name)}&sub=${encodeURIComponent(l2Item.name)}`}
                        className={`flex items-center gap-1 rounded-[var(--brand-border-radius)] px-2 py-1 text-sm font-medium ${headerInteractiveText} ${headerInteractiveHover} hover:bg-[var(--brand-color-primary-bg)] ${uiSurfaces.focusRing}`}>
                        {l2Item.name}
                        {l2Item.child && l2Item.child.length > 0 && <ChevronDown size={14} className={`transition-transform ${hoverL3Open ? 'rotate-180' : ''}`} />}
                      </Link>
                      {l2Item.child && l2Item.child.length > 0 && (
                        <div
                          data-nav-submenu
                          data-nav-open={hoverL3Open ? 'true' : 'false'}
                          className={`absolute top-full left-0 pt-1 z-[70] transition-all duration-200 ${hoverL3Open ? 'opacity-100 visible pointer-events-auto' : 'opacity-0 invisible pointer-events-none'}`}
                        >
                          <div data-header-popup className={`max-h-[calc(100vh-8rem)] w-48 overflow-y-auto py-2 ${popupSurface}`}>
                            {l2Item.child.map((child) => (
                              <button
                                key={child}
                                onClick={() => onL3Click?.(child)}
                                className={`w-full px-4 py-2 text-left text-sm ${popupItem} ${l3Type === child ? `bg-[var(--brand-color-primary-bg)] font-medium ${headerInteractiveActive}` : ''}`}
                              >
                                {child}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {l3Type && (
                      <>
                        <span className={uiSurfaces.mutedText}>—</span>
                        <span className={`flex-shrink-0 text-sm font-medium ${headerInteractiveActive}`}>{l3Type}</span>
                      </>
                    )}
                  </>
                );
              })()}

              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={toggleTheme}
                  className={`flex items-center justify-center rounded-[var(--brand-border-radius)] p-1.5 transition-colors hover:bg-[var(--brand-color-primary-bg-hover)] ${uiSurfaces.focusRing}`}
                  title={theme === 'light' ? '浅色模式' : theme === 'dark' ? '深色模式' : '跟随系统'}
                >
                  {!mounted ? (
                    <Sunset size={16} className={headerMutedText} />
                  ) : theme === 'light' ? (
                    <Sun size={16} className="text-[var(--brand-color-warning)]" />
                  ) : theme === 'dark' ? (
                    <Moon size={16} className={headerMutedText} />
                  ) : (
                    <Sunset size={16} className="text-[var(--brand-color-warning-text)]" />
                  )}
                </button>
              </div>
            </div>
            </div>
          )}
        </div>
      </header>

      <MobileSiteMenu
        key={mobileSiteMenuOpen ? 'open' : 'closed'}
        isOpen={mobileSiteMenuOpen}
        onClose={() => setMobileSiteMenuOpen(false)}
        onQuickOrder={handleQuickOrderClick}
      />

      {/* 文档流占位：实测 header 高度 + 额外间距，避免内容顶住页头 */}
      <div
        aria-hidden
        data-site-header-spacer="true"
        className="shrink-0 w-full pointer-events-none"
        style={{ height: 'calc(var(--site-header-height) + var(--site-header-gap))' }}
      />

      {showQuickOrderModal && (
        <QuickOrderModal onClose={() => setShowQuickOrderModal(false)} />
      )}
    </>
  );
}
