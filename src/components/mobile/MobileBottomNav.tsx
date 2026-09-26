'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User } from 'lucide-react';
import MobileCartButton from './MobileCartButton';
import MobileProductButton from './MobileProductButton';
import MobileAccountMenu from './MobileAccountMenu';
import MobileSupportButton from './MobileSupportButton';
import { uiSurfaces } from '@/lib/ui-surfaces';

export default function MobileBottomNav() {
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const { status } = useSession();
  const pathname = usePathname();
  const productActive = pathname.startsWith('/products') || pathname.startsWith('/brands') || pathname.startsWith('/promotions');
  const supportActive = pathname.startsWith('/support') || pathname.startsWith('/protocols') || pathname.startsWith('/scenes') || pathname.startsWith('/research-tools') || pathname.startsWith('/resources') || pathname.startsWith('/academic-support');
  const accountActive = pathname.startsWith('/account') || pathname.startsWith('/login') || pathname.startsWith('/register');
  const cartActive = pathname.startsWith('/cart');

  // 8/4 方案1：向下滚动隐藏底部导航（让内容延伸到屏幕底），向上滚动/回到顶部/滚到底部时显示
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

  return (
    <>
      <nav aria-label="移动端主导航" className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden ${navHidden ? 'hidden' : 'block'} ${uiSurfaces.mobileNav}`}>
        <div className="mx-auto grid w-full max-w-lg grid-cols-4 gap-1 px-2 py-1.5">
          <MobileProductButton active={productActive} />

          <MobileSupportButton active={supportActive} />

          {status === 'authenticated' ? (
            <button
              onClick={() => setShowAccountMenu(true)}
              aria-expanded={showAccountMenu}
              aria-haspopup="dialog"
              className={`${uiSurfaces.mobileNavItem} ${accountActive || showAccountMenu ? uiSurfaces.mobileNavItemActive : ''}`}
            >
              <User size={22} className="pointer-events-none" />
              <span>账户</span>
            </button>
          ) : (
            <Link
              href="/login"
              className={`${uiSurfaces.mobileNavItem} ${accountActive ? uiSurfaces.mobileNavItemActive : ''}`}
            >
              <User size={22} className="pointer-events-none" />
              <span>账户</span>
            </Link>
          )}

          <MobileCartButton active={cartActive} />
        </div>
      </nav>

      <MobileAccountMenu
        isOpen={showAccountMenu}
        onClose={() => setShowAccountMenu(false)}
      />
    </>
  );
}
