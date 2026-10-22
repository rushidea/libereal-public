'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Bell, X } from 'lucide-react';
import {
  countUnreadByModule,
  CUSTOMER_NOTIFICATION_SEEN_STORAGE_KEY,
  emptyCustomerNotificationModuleCounts,
  isCustomerNotificationModule,
  normalizeCustomerNotificationModuleCounts,
  planNotificationArrival,
  readSeenNotificationIds,
  resolveCustomerNotificationModule,
  sumCustomerNotificationModuleCounts,
  writeSeenNotificationIds,
  type CustomerNotificationModule,
  type CustomerNotificationModuleCounts,
} from '@/lib/customer-notification-modules';

const POLL_INTERVAL_MS = 30_000;
const BELL_PULSE_MS = 1_200;
const TOAST_MS = 6_000;

export type CustomerInboxNotification = {
  id: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  linkUrl?: string | null;
  metadata?: string | null;
  createdAt: string;
};

type Snapshot = {
  unreadByModule: CustomerNotificationModuleCounts;
  unreadTotal: number;
  recentUnread: CustomerInboxNotification[];
};

type ArrivalToast = {
  id: string;
  message: string;
  href: string;
};

type CustomerNotificationsValue = {
  unreadByModule: CustomerNotificationModuleCounts;
  unreadTotal: number;
  recentUnread: CustomerInboxNotification[];
  bellPulse: boolean;
  refresh: () => Promise<void>;
  markModuleRead: (moduleName: CustomerNotificationModule) => Promise<void>;
  markIdsRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const EMPTY_SNAPSHOT: Snapshot = {
  unreadByModule: emptyCustomerNotificationModuleCounts(),
  unreadTotal: 0,
  recentUnread: [],
};

const CustomerNotificationsContext = createContext<CustomerNotificationsValue | null>(null);

function sessionStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function CustomerNotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [bellPulse, setBellPulse] = useState(false);
  const [toast, setToast] = useState<ArrivalToast | null>(null);
  const initializedRef = useRef(false);
  const seenRef = useRef<string[]>([]);
  const pendingClearRef = useRef<Set<CustomerNotificationModule>>(new Set());
  const requestRef = useRef(0);
  const skipPathRefreshRef = useRef(true);
  const pulseTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const applySnapshot = useCallback((notifications: CustomerInboxNotification[], unreadByModule: CustomerNotificationModuleCounts) => {
    const counts = { ...unreadByModule };
    for (const moduleName of pendingClearRef.current) counts[moduleName] = 0;
    const recentUnread = notifications
      .filter((item) => !item.isRead && !pendingClearRef.current.has(resolveCustomerNotificationModule(item)))
      .slice(0, 5);
    setSnapshot({
      unreadByModule: counts,
      unreadTotal: sumCustomerNotificationModuleCounts(counts),
      recentUnread,
    });
  }, []);

  const showArrival = useCallback((message: string, href: string) => {
    setToast({ id: `notif-${Date.now()}`, message, href });
    setBellPulse(true);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setBellPulse(false), BELL_PULSE_MS);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const refresh = useCallback(async () => {
    if (status !== 'authenticated') return;
    const requestId = ++requestRef.current;
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const data = await response.json();
      if (requestId !== requestRef.current) return;
      const notifications: CustomerInboxNotification[] = Array.isArray(data.notifications) ? data.notifications : [];
      const unread = notifications.filter((item) => !item.isRead);
      const unreadByModule = data.unreadByModule
        ? normalizeCustomerNotificationModuleCounts(data.unreadByModule)
        : countUnreadByModule(notifications);
      const plan = planNotificationArrival({
        initialized: initializedRef.current,
        seenIds: seenRef.current,
        unread,
      });
      initializedRef.current = true;
      seenRef.current = plan.seenIds;
      writeSeenNotificationIds(sessionStorageOrNull(), plan.seenIds);
      applySnapshot(notifications, unreadByModule);
      if (plan.kind === 'summary') showArrival(plan.message, plan.href);
    } catch {
      // Notification refresh is best effort and must not interrupt navigation.
    }
  }, [applySnapshot, showArrival, status]);

  const markModuleRead = useCallback(async (moduleName: CustomerNotificationModule) => {
    pendingClearRef.current.add(moduleName);
    setSnapshot((current) => {
      const unreadByModule = { ...current.unreadByModule, [moduleName]: 0 };
      return {
        unreadByModule,
        unreadTotal: sumCustomerNotificationModuleCounts(unreadByModule),
        recentUnread: current.recentUnread.filter((item) => resolveCustomerNotificationModule(item) !== moduleName),
      };
    });
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName }),
      });
    } catch {
      // The next refresh restores the badge if the write did not land.
    } finally {
      pendingClearRef.current.delete(moduleName);
      await refresh();
    }
  }, [refresh]);

  const patchRead = useCallback(async (body: { ids: string[] } | { markAll: true }) => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Caller still refreshes so the badge matches the server.
    }
    await refresh();
  }, [refresh]);

  const markIdsRead = useCallback(async (ids: string[]) => {
    const clean = ids.filter((id) => typeof id === 'string' && id.length > 0);
    if (clean.length === 0) return;
    await patchRead({ ids: clean });
  }, [patchRead]);

  const markAllRead = useCallback(async () => {
    await patchRead({ markAll: true });
  }, [patchRead]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated') {
      requestRef.current += 1;
      initializedRef.current = false;
      seenRef.current = [];
      pendingClearRef.current.clear();
      skipPathRefreshRef.current = true;
      sessionStorageOrNull()?.removeItem(CUSTOMER_NOTIFICATION_SEEN_STORAGE_KEY);
      setSnapshot(EMPTY_SNAPSHOT);
      setToast(null);
      setBellPulse(false);
      return;
    }

    seenRef.current = readSeenNotificationIds(sessionStorageOrNull());
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void refresh();
    }, POLL_INTERVAL_MS);
    const onWake = () => {
      if (document.visibilityState === 'hidden') return;
      void refresh();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [refresh, status]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (skipPathRefreshRef.current) {
      skipPathRefreshRef.current = false;
      return;
    }
    void refresh();
  }, [pathname, refresh, status]);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const value = useMemo<CustomerNotificationsValue>(() => ({
    unreadByModule: snapshot.unreadByModule,
    unreadTotal: snapshot.unreadTotal,
    recentUnread: snapshot.recentUnread,
    bellPulse,
    refresh,
    markModuleRead,
    markIdsRead,
    markAllRead,
  }), [bellPulse, markAllRead, markIdsRead, markModuleRead, refresh, snapshot]);

  return (
    <CustomerNotificationsContext.Provider value={value}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed right-3 top-16 z-[calc(var(--site-overlay-z)+30)] w-[min(100%-1.5rem,22rem)] lg:right-6 lg:top-20">
          <div
            role="status"
            data-testid="customer-notification-toast"
            className="toast-slide-up pointer-events-auto flex items-start gap-3 rounded-xl border border-[var(--brand-color-info-border)] bg-[var(--brand-color-info-bg)] px-3 py-3 shadow-lg backdrop-blur-sm"
          >
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-color-info)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--brand-color-text)]">{toast.message}</p>
              <Link
                href={toast.href}
                className="mt-1 inline-flex text-xs font-medium text-[var(--brand-color-text-interactive)] hover:text-[var(--brand-color-text-interactive-hover)]"
                onClick={() => setToast(null)}
              >
                查看
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded-full p-1 text-[var(--brand-color-text-quaternary)] hover:bg-[color-mix(in_srgb,var(--brand-color-text)_8%,transparent)]"
              aria-label="关闭提示"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </CustomerNotificationsContext.Provider>
  );
}

const FALLBACK: CustomerNotificationsValue = {
  ...EMPTY_SNAPSHOT,
  bellPulse: false,
  refresh: async () => {},
  markModuleRead: async () => {},
  markIdsRead: async () => {},
  markAllRead: async () => {},
};

export function useCustomerNotifications(): CustomerNotificationsValue {
  return useContext(CustomerNotificationsContext) ?? FALLBACK;
}

export function useMarkNotificationModuleRead(moduleName: CustomerNotificationModule | null) {
  const { unreadByModule, markModuleRead } = useCustomerNotifications();
  const count = moduleName ? unreadByModule[moduleName] : 0;
  const attemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!moduleName || !isCustomerNotificationModule(moduleName) || count <= 0) {
      if (count <= 0) attemptedRef.current = null;
      return;
    }
    const token = `${moduleName}:${count}`;
    if (attemptedRef.current === token) return;
    attemptedRef.current = token;
    void markModuleRead(moduleName);
  }, [count, markModuleRead, moduleName]);
}
