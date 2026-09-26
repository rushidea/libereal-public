'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { User, Package, FileText, Bell, MapPin, Key, LogOut, Building2 } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import BottomPopup from './BottomPopup';

interface MobileAccountMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileAccountMenu({ isOpen, onClose }: MobileAccountMenuProps) {
  const { status } = useSession();

  if (!isOpen) return null;

  if (status === 'unauthenticated') {
    return (
      <BottomPopup isOpen={isOpen} onClose={onClose}>
        <div className="px-4 py-6">
          <p className={`mb-1 text-center text-lg font-semibold ${uiSurfaces.titleText}`}>账户</p>
          <p className={`mb-6 text-center text-sm ${uiSurfaces.mutedText}`}>登录后可管理您的账户信息</p>
          <Link
            href="/login"
            onClick={onClose}
            className={`${uiSurfaces.buttonPrimary} w-full text-sm`}
          >
            登录
          </Link>
          <Link
            href="/register"
            onClick={onClose}
            className={`${uiSurfaces.buttonSecondary} mt-3 w-full text-sm`}
          >
            注册
          </Link>
        </div>
      </BottomPopup>
    );
  }

  if (status === 'loading') {
    return (
      <BottomPopup isOpen={isOpen} onClose={onClose}>
        <div className="flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-[var(--brand-border-radius-pill)] border-2 border-[var(--brand-color-primary)] border-t-transparent" />
        </div>
      </BottomPopup>
    );
  }

  return (
      <BottomPopup isOpen={isOpen} onClose={onClose}>
      <div className={`border-b px-4 py-3 ${uiSurfaces.border}`}>
        <p className={`text-sm font-semibold ${uiSurfaces.titleText}`}>账户</p>
        <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>管理您的账户信息</p>
      </div>
      <div className="py-2">
        <Link href="/account" onClick={onClose} className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
          <User size={18} className={uiSurfaces.textInteractive} />
          <span className={`text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`}>我的账户</span>
        </Link>
        <Link href="/account/orders" onClick={onClose} className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
          <Package size={18} className={uiSurfaces.textInteractive} />
          <span className={`text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`}>我的订单</span>
        </Link>
        <Link href="/account/inquiries" onClick={onClose} className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
          <FileText size={18} className={uiSurfaces.textInteractive} />
          <span className={`text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`}>我的询价</span>
        </Link>
        <Link href="/account/notifications" onClick={onClose} className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
          <Bell size={18} className={uiSurfaces.textInteractive} />
          <span className={`text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`}>消息中心</span>
        </Link>
        <Link href="/account/addresses" onClick={onClose} className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
          <MapPin size={18} className={uiSurfaces.textInteractive} />
          <span className={`text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`}>收货地址</span>
        </Link>
        <Link href="/account/settings" onClick={onClose} className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
          <Key size={18} className={uiSurfaces.textInteractive} />
          <span className={`text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`}>账户设置</span>
        </Link>
        <Link href="/account/organizations" onClick={onClose} className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
          <Building2 size={18} className={uiSurfaces.textInteractive} />
          <span className={`text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`}>组织管理</span>
        </Link>
      </div>
      <div className={`border-t pt-2 ${uiSurfaces.border}`}>
        <button
          onClick={() => { onClose(); signOut({ callbackUrl: typeof window !== 'undefined' ? window.location.origin : '/' }); }}
          className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-[var(--brand-color-error-text)] transition-colors hover:bg-[var(--brand-color-error-bg)] hover:text-[var(--brand-color-error-hover)] ${uiSurfaces.focusRing}`}
          type="button"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">退出登录</span>
        </button>
      </div>
    </BottomPopup>
  );
}
