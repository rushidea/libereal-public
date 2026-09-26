'use client';

import { PanelLeftClose, PanelLeftOpen, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { uiSurfaces } from '@/lib/ui-surfaces';

const ADMIN_SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [adminMfaRequired, setAdminMfaRequired] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_KEY) === 'true');
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/access?view=current', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { mfaPolicy?: { required?: boolean; satisfied?: boolean } } | null) => {
        if (active) setAdminMfaRequired(Boolean(data?.mfaPolicy?.required && !data.mfaPolicy.satisfied));
      })
      .catch(() => {
        if (active) setAdminMfaRequired(false);
      });
    return () => { active = false; };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <AdminSidebar collapsed={sidebarCollapsed} />
      <div className="min-w-0 flex-1">
        <div className="mb-3 hidden justify-end lg:flex">
          <button
            type="button"
            onClick={toggleSidebar}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.toolbar} ${uiSurfaces.focusRing} transition`}
            title={sidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
            aria-label={sidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        {adminMfaRequired && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span>管理员账户需要先设置双因素认证，才能执行敏感操作。</span>
              <Link href="/account/security" className="shrink-0 font-medium underline underline-offset-2">前往安全中心</Link>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
