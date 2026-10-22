'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useCart } from './CartContext';

/**
 * Syncs cart state to/from the database when user signs in or out.
 * Must be rendered inside SessionProvider.
 */
export default function CartSync() {
  const { data: session, status } = useSession();
  const { syncFromDb } = useCart();

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      syncFromDb();
    }
  }, [status, session?.user?.id, syncFromDb]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      syncFromDb();
    }
  }, [status, syncFromDb]);

  return null;
}
