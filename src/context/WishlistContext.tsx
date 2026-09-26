'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { Product } from '@/types/Product';

type WishlistItem = Product & { addedAt?: string; wishlistId?: string };

type WishlistContextType = {
  wishlist: WishlistItem[];
  isLoading: boolean;
  isSyncing: boolean;
  addToWishlist: (product: Product) => Promise<void>;
  removeFromWishlist: (productId: string) => Promise<void>;
  clearWishlist: () => Promise<void>;
  isInWishlist: (productId: string) => boolean;
  toggleWishlist: (product: Product) => Promise<void>;
  syncFromDb: () => Promise<void>;
  flushLocalToDb: () => Promise<void>;
};

const WishlistContext = createContext<WishlistContextType | null>(null);

const STORAGE_KEY = 'libereal_wishlist';
const MIGRATED_KEY = 'libereal_wishlist_migrated';

function loadFromLocal(): WishlistItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function saveToLocal(items: WishlistItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Initial load from localStorage
  useEffect(() => {
    setWishlist(loadFromLocal());
    setIsLoading(false);
  }, []);

  // Persist to localStorage whenever wishlist changes (always, for fast initial render)
  useEffect(() => {
    if (!isLoading) saveToLocal(wishlist);
  }, [wishlist, isLoading]);

  // Flush local-only items to DB on sign-in (one-time per device)
  const flushLocalToDb = useCallback(async () => {
    if (status !== 'authenticated' || !session?.user?.id) return;
    const alreadyMigrated = localStorage.getItem(MIGRATED_KEY);
    if (alreadyMigrated) return;

    const local = loadFromLocal();
    if (local.length === 0) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return;
    }

    setIsSyncing(true);
    try {
      for (const item of local) {
        try {
          await fetch('/api/wishlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: item.id }),
          });
        } catch {}
      }
      localStorage.setItem(MIGRATED_KEY, '1');
    } finally {
      setIsSyncing(false);
    }
  }, [status, session?.user?.id]);

  // Sync from DB when authenticated
  const syncFromDb = useCallback(async () => {
    if (status !== 'authenticated' || !session?.user?.id) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/wishlist');
      if (res.ok) {
        const data: WishlistItem[] = await res.json();
        setWishlist(data);
      }
    } catch (err) {
      console.error('[WishlistContext] sync from DB failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [status, session?.user?.id]);

  // When session changes
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      flushLocalToDb().then(() => syncFromDb());
    } else if (status === 'unauthenticated') {
      // Clear migrated flag so next login migrates again
      localStorage.removeItem(MIGRATED_KEY);
      setWishlist(loadFromLocal());
    }
  }, [status, session?.user?.id, flushLocalToDb, syncFromDb]);

  const addToWishlist = useCallback(async (product: Product) => {
    // Optimistic local update
    setWishlist(prev => prev.some(p => p.id === product.id) ? prev : [...prev, product]);
    // Sync to DB if authenticated
    if (status === 'authenticated') {
      try {
        await fetch('/api/wishlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: product.id }),
        });
      } catch (err) {
        console.error('[WishlistContext] add to DB failed:', err);
      }
    }
  }, [status]);

  const removeFromWishlist = useCallback(async (productId: string) => {
    // Optimistic local update
    setWishlist(prev => prev.filter(p => p.id !== productId));
    // Sync to DB if authenticated
    if (status === 'authenticated') {
      try {
        await fetch(`/api/wishlist/${productId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('[WishlistContext] remove from DB failed:', err);
      }
    }
  }, [status]);

  const clearWishlist = useCallback(async () => {
    const current = wishlist;
    setWishlist([]);
    if (status === 'authenticated') {
      await Promise.all(current.map(item =>
        fetch(`/api/wishlist/${item.id}`, { method: 'DELETE' }).catch(() => {})
      ));
    }
  }, [wishlist, status]);

  const isInWishlist = useCallback((productId: string) => {
    return wishlist.some(p => p.id === productId);
  }, [wishlist]);

  const toggleWishlist = useCallback(async (product: Product) => {
    if (isInWishlist(product.id)) {
      await removeFromWishlist(product.id);
    } else {
      await addToWishlist(product);
    }
  }, [isInWishlist, addToWishlist, removeFromWishlist]);

  return (
    <WishlistContext.Provider value={{
      wishlist,
      isLoading,
      isSyncing,
      addToWishlist,
      removeFromWishlist,
      clearWishlist,
      isInWishlist,
      toggleWishlist,
      syncFromDb,
      flushLocalToDb,
    }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error('useWishlist must be used within WishlistProvider');
  return context;
}
