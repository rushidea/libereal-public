'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { CustomerNotificationsProvider } from '@/context/CustomerNotificationsContext';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <CustomerNotificationsProvider>{children}</CustomerNotificationsProvider>
    </NextAuthSessionProvider>
  );
}
