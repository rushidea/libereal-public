'use client';

import { createContext, useContext, useState, ReactNode, useRef, useCallback, useEffect } from 'react';
import { Product } from '@/types/Product';
import { useToast } from './ToastContext';
import { detectAddonEligibility, isAddonProduct } from '@/lib/cart-promotions/detect';
import { getRuleLifecycle } from '@/lib/cart-promotions/lifecycle';
import { isGiftProduct } from '@/lib/cart-promotions/matching';
import { PROMOTION_RULES } from '@/lib/cart-promotions/rules';
import { isPricedProduct } from '@/lib/product-pricing';

export interface QuickOrderItem {
  isQuickOrder: true;
  quickId: string;
  name: string;
  brand: string;
  catalogNumber: string;
  quantity: number;
  unit: string;
}

export interface ProductCartItem {
  isQuickOrder?: false;
  product: Product;
  quantity: number;
  /** 换购标记：命中购物车换购活动时由结算页加入（addon.ruleId 对应 CART_ADDON_RULES） */
  addon?: { ruleId: string; addonPrice: number };
}

export type CartItem = ProductCartItem | QuickOrderItem;

export interface CartHistory {
  name: string;
  items: CartItem[];
  savedAt: string;
}

function normalizeCartKeyPart(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function getProductCartKey(product: Pick<Product, 'id' | 'brand' | 'catalogNumber' | 'variantId' | 'spec'>): string {
  const brand = normalizeCartKeyPart(product.brand);
  const catalogNumber = normalizeCartKeyPart(product.catalogNumber);

  if (brand && catalogNumber) {
    const variantId = normalizeCartKeyPart(product.variantId);
    if (variantId) return `product:${brand}:${catalogNumber}:variant:${variantId}`;
    return `product:${brand}:${catalogNumber}:spec:${normalizeCartKeyPart(product.spec)}`;
  }

  return `product-id:${normalizeCartKeyPart(product.id)}`;
}

function productMatchesIdentifier(product: Product, identifier: string): boolean {
  return product.id === identifier
    || product.catalogNumber === identifier
    || product.variantId === identifier
    || getProductCartKey(product) === identifier;
}

export function getCartItemKey(item: CartItem): string {
  if (item.isQuickOrder) return item.quickId;
  return `${getProductCartKey(item.product)}:promotion:${item.addon?.ruleId ?? 'regular'}`;
}

function cartItemMatchesIdentifier(item: CartItem, identifier: string): boolean {
  return item.isQuickOrder
    ? item.quickId === identifier
    : getCartItemKey(item) === identifier || (!item.addon && productMatchesIdentifier(item.product, identifier));
}

export function mergeCartProductItems(items: CartItem[]): CartItem[] {
  const mergedProducts = new Map<string, ProductCartItem>();
  const result: CartItem[] = [];

  for (const item of items) {
    if (item.isQuickOrder) {
      result.push(item);
      continue;
    }

    const key = getCartItemKey(item);
    const existing = mergedProducts.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.product = item.product;
      continue;
    }

    const entry: ProductCartItem = { ...item };
    mergedProducts.set(key, entry);
    result.push(entry);
  }

  return result;
}

interface CartContextType {
  items: CartItem[];
  addItem: (product: Product) => void;
  /** 以换购价加入购物车（product 原价结算，结算页按 addon 优惠扣除差额） */
  addAddonItem: (product: Product, ruleId: string, addonPrice: number) => void;
  /** 活动页选中的换购品或赠品带活动标记入车，价格由购物车和服务端重新计算。 */
  addPromotionItem: (product: Product, ruleId: string) => void;
  addQuickOrderItem: (item: Omit<QuickOrderItem, 'isQuickOrder' | 'quickId'>) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  clearQuickOrderItems: () => void;
  isInCart: (productId: string) => boolean;
  totalItems: number;
  syncFromDb: () => Promise<void>;
  syncToDb: (items: CartItem[]) => void;
  forceSync: () => void;
  saveCartHistory: (name: string) => void;
  getCartHistory: () => CartHistory[];
  restoreFromHistory: (index: number) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const GUEST_CART_KEY = 'libereal_guest_cart';
const CART_HISTORY_KEY = 'libereal_cart_history';
const MAX_HISTORY = 5;

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef<CartItem[]>([]);
  const toast = useToast();
  const guestSaveToastShownRef = useRef(false);

  const saveToLocalStorage = (items: CartItem[]) => {
    try {
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
    } catch {}
  };

  const notifyGuestCartSaved = useCallback(() => {
    if (guestSaveToastShownRef.current) return;
    guestSaveToastShownRef.current = true;
    toast?.show('购物车已临时保存在本机', 'info');
  }, [toast]);

  useEffect(() => {
    // Mount-time initialization: load guest cart from localStorage.
    try {
      const stored = localStorage.getItem(GUEST_CART_KEY);
      if (stored) {
        const storedItems = mergeCartProductItems(JSON.parse(stored));
        itemsRef.current = storedItems;
        saveToLocalStorage(storedItems);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(storedItems);
      }
    } catch {}
  }, []);

  const syncToDb = useCallback((items: CartItem[]) => {
    const normalizedItems = mergeCartProductItems(items);
    itemsRef.current = normalizedItems;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/cart', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsRef.current }),
        });
        if (res.status === 401) {
          saveToLocalStorage(itemsRef.current);
          notifyGuestCartSaved();
        }
      } catch (err) {
        console.error('[CartContext] sync to DB failed:', err);
        saveToLocalStorage(itemsRef.current);
        notifyGuestCartSaved();
      }
    }, 500);
  }, [notifyGuestCartSaved]);

  const syncFromDb = useCallback(async () => {
    try {
      const res = await fetch('/api/cart');
      if (res.ok) {
        const data = await res.json();
        const dbItems: CartItem[] = mergeCartProductItems(data.items ?? []);
        setItems((prevLocal) => {
          if (dbItems.length > 0) {
            itemsRef.current = dbItems;
            saveToLocalStorage(dbItems);
            return dbItems;
          }
          const stored = localStorage.getItem(GUEST_CART_KEY);
          if (stored) {
            try {
              const localData = mergeCartProductItems(JSON.parse(stored));
              itemsRef.current = localData;
              saveToLocalStorage(localData);
              return localData;
            } catch {}
          }
          return prevLocal;
        });
      } else if (res.status === 401) {
        try {
          const stored = localStorage.getItem(GUEST_CART_KEY);
          if (stored) {
            const localData = mergeCartProductItems(JSON.parse(stored));
            itemsRef.current = localData;
            saveToLocalStorage(localData);
            setItems(localData);
          }
        } catch {}
      }
    } catch (err) {
      console.error('[CartContext] sync from DB failed:', err);
      try {
        const stored = localStorage.getItem(GUEST_CART_KEY);
        if (stored) {
          const localData = mergeCartProductItems(JSON.parse(stored));
          itemsRef.current = localData;
          saveToLocalStorage(localData);
          setItems(localData);
        }
      } catch {}
    }
  }, []);

  const setItemsAndSync = useCallback((updater: (prev: CartItem[]) => CartItem[]) => {
    setItems((prev) => {
      const next = mergeCartProductItems(updater(prev));
      itemsRef.current = next;
      syncToDb(next);
      return next;
    });
  }, [syncToDb]);

  const addItem = (product: Product) => {
    setItemsAndSync((prev) => {
      const key = getProductCartKey(product);
      let found = false;
      const next = prev.map((item) => {
        if (!item.isQuickOrder && !item.addon && getProductCartKey(item.product) === key) {
          found = true;
          return { ...item, product, quantity: item.quantity + 1 };
        }
        return item;
      });
      if (found) return next;
      return [...prev, { product, quantity: 1 }];
    });
  };

  const addAddonItem = (product: Product, ruleId: string, addonPrice: number) => {
    const key = getProductCartKey(product);
    setItemsAndSync((prev) => {
      const eligibility = detectAddonEligibility(prev.filter((item) => !item.isQuickOrder && isPricedProduct(item.product)))
        .find((entry) => entry.rule.id === ruleId);
      if (!eligibility?.active || !eligibility.triggered || eligibility.remainingQuota <= 0
        || eligibility.rule.addonPrice !== addonPrice || !isAddonProduct(eligibility.rule, product)) return prev;
      const existing = prev.find(
        (item) => !item.isQuickOrder && item.addon?.ruleId === ruleId && getProductCartKey(item.product) === key,
      );
      if (existing) {
        return prev.map((item) =>
          item === existing ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { product, quantity: 1, addon: { ruleId, addonPrice } }];
    });
  };

  const addPromotionItem = (product: Product, ruleId: string) => {
    const rule = PROMOTION_RULES.find((entry) => entry.id === ruleId);
    if (!rule || getRuleLifecycle(rule) !== 'active') return;
    const matchesRule = rule.type === 'addon'
      ? isAddonProduct(rule, product)
      : rule.type === 'gift' && isGiftProduct(rule, product);
    if (!matchesRule) return;
    const key = getProductCartKey(product);
    const addonPrice = rule.type === 'addon' ? rule.addonPrice : 0;
    setItemsAndSync((prev) => {
      const existing = prev.find((item) => !item.isQuickOrder
        && item.addon?.ruleId === ruleId && getProductCartKey(item.product) === key);
      if (existing) return prev.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { product, quantity: 1, addon: { ruleId, addonPrice } }];
    });
  };

  const addQuickOrderItem = (
    item: Omit<QuickOrderItem, 'isQuickOrder' | 'quickId'>
  ) => {
    const newItem: QuickOrderItem = {
      ...item,
      isQuickOrder: true,
      quickId: `qo-${crypto.randomUUID()}`,
    };
    setItemsAndSync((prev) => [...prev, newItem]);
  };

  const removeItem = (itemId: string) => {
    setItemsAndSync((prev) =>
      prev.filter((item) =>
        !cartItemMatchesIdentifier(item, itemId)
      )
    );
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    if (!Number.isSafeInteger(quantity)) return;
    if (quantity <= 0) {
      removeItem(itemId);
      return;
    }
    setItemsAndSync((prev) => {
      const target = prev.find((item) => cartItemMatchesIdentifier(item, itemId));
      if (target && !target.isQuickOrder && target.addon && quantity > target.quantity) {
        const eligibility = detectAddonEligibility(prev.filter((item) => !item.isQuickOrder && isPricedProduct(item.product)))
          .find((entry) => entry.rule.id === target.addon!.ruleId);
        if (!eligibility?.active || quantity - target.quantity > eligibility.remainingQuota) return prev;
      }
      return prev.map((item) =>
        cartItemMatchesIdentifier(item, itemId)
          ? { ...item, quantity }
          : item
      );
    });
  };

  const clearCart = () => {
    setItemsAndSync(() => []);
  };

  const clearQuickOrderItems = () => {
    setItemsAndSync((prev) => prev.filter((item) => !item.isQuickOrder));
  };

  const isInCart = (productId: string) =>
    items.some(
      (item) => !item.isQuickOrder && cartItemMatchesIdentifier(item, productId)
    );

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  const forceSync = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncToDb(itemsRef.current);
  }, [syncToDb]);

  const getCartHistory = useCallback((): CartHistory[] => {
    try {
      const stored = localStorage.getItem(CART_HISTORY_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    return [];
  }, []);

  const saveCartHistory = useCallback((name: string) => {
    const history = getCartHistory();
    const newEntry: CartHistory = {
      name,
      items: itemsRef.current,
      savedAt: new Date().toISOString(),
    };
    history.unshift(newEntry);
    if (history.length > MAX_HISTORY) {
      history.pop();
    }
    localStorage.setItem(CART_HISTORY_KEY, JSON.stringify(history));
    if (toast) {
      toast.show('购物车已保存在本地（清空浏览器缓存会清除记录）', 'success');
    }
  }, [getCartHistory, toast]);

  const restoreFromHistory = useCallback((index: number) => {
    const history = getCartHistory();
    if (index >= 0 && index < history.length) {
      const restoredItems = mergeCartProductItems(history[index].items);
      setItemsAndSync((prev) => {
        const existingIds = new Set(
          prev.map(getCartItemKey)
        );
        const deduped = restoredItems.filter(item =>
          item.isQuickOrder
            ? !existingIds.has(item.quickId)
            : !existingIds.has(getCartItemKey(item))
        );
        return [...prev, ...deduped];
      });
    }
  }, [getCartHistory, setItemsAndSync]);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        addAddonItem,
        addPromotionItem,
        addQuickOrderItem,
        removeItem,
        updateQuantity,
        clearCart,
        clearQuickOrderItems,
        isInCart,
        totalItems,
        syncFromDb,
        syncToDb,
        forceSync,
        saveCartHistory,
        getCartHistory,
        restoreFromHistory,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}

/** 促销信息等可脱离购物车容器渲染的只读组件使用。 */
export function useOptionalCart() {
  return useContext(CartContext);
}
