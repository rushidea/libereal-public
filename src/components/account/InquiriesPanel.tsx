'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Package, FileText, Check, Clock, ExternalLink, X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import LegalConsentModal from '@/components/legal/LegalConsentModal';
import { QuoteAcceptancePreview, QuoteQuantityEditor } from '@/components/account/QuoteQuantityEditor';
import { QuoteQuantityNudgeNotice } from '@/components/account/QuoteQuantityNudge';
import { findQuoteQuantityNudges } from '@/lib/quote-quantity-nudge';
import { customerCanAcceptQuote, effectiveInquiryStatus, quoteIsExpired } from '@/lib/quote-expiry';
import DeclineQuoteDialog from '@/components/account/DeclineQuoteDialog';
import { CheckoutPaymentFields, useCheckoutPointsBalance } from '@/components/checkout/CheckoutPaymentFields';
import { InquiryIdDisplay } from '@/components/InquiryIdDisplay';
import { quoteConfirmSettlementFields } from '@/lib/admin-acting-points';
import { describeCheckoutPayable } from '@/lib/checkout-payment';
import { startAlipayCheckout } from '@/lib/alipay-checkout-client';

interface InquiryItem {
  id?: string;
  isQuickOrder?: boolean;
  name?: string;
  brand?: string;
  catalogNumber?: string;
  product?: {
    name?: string;
    brand?: string;
    catalogNumber?: string;
    promotionalPrice?: number;
    price?: number;
  };
  quantity?: number;
  orderedQty?: number;
  price?: number;
  unit?: string;
  leadTime?: string;
  customerLeadTime?: string | null;
  actualLeadTime?: string | null;
  available?: boolean | null;
  ordered?: boolean;
  locked?: boolean;
  minQuantity?: number | null;
  quantityStep?: number | null;
  category?: string | null;
  subcategory?: string | null;
  type?: string | null;
}

interface LinkedOrder {
  id: string;
  inquiryId: string;
  email: string;
  items: InquiryItem[];
  subtotal: number;
  status: string;
  paymentMethod?: string;
  createdAt: string;
}

interface Inquiry {
  id: string;
  name: string;
  email: string;
  institution: string;
  department?: string;
  items: InquiryItem[];
  subtotal: number;
  hasUnresolvedPricing?: boolean;
  status: string;
  createdAt: string;
  organizationId?: string | null;
  ownerScope?: 'personal' | 'organization';
  activeQuote?: { id: string; version: number; status: string; subtotal: number; validUntil?: string | null; sentAt?: string; acceptedAt?: string; items: InquiryItem[] } | null;
  orderCount?: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  'pending_quote': { label: '待报价', color: uiSurfaces.badgeWarning, icon: Clock },
  'quote_sent': { label: '已报价', color: uiSurfaces.badgeSuccess, icon: FileText },
  'quote_expired': { label: '已过期', color: 'bg-amber-100 text-amber-800', icon: Clock },
  'closed': { label: '待报价', color: uiSurfaces.badgeWarning, icon: Clock },
  'declined': { label: '已放弃', color: 'bg-gray-100 text-gray-600', icon: X },
};

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
};

function parseItems(items: InquiryItem[]): InquiryItem[] { return items; }
function remainingQuantity(item: InquiryItem) {
  const quoted = item.quantity || 1;
  return Math.max(0, quoted - Math.min(quoted, item.orderedQty ?? (item.ordered ? quoted : 0)));
}

type AcceptanceSnapshot = { inquiryId: string; quoteId: string; quoteVersion: number; itemIndices: number[]; itemIds: string[]; quantities: number[]; acceptedLegalIds: string[]; actorScope: string; attemptId: string; createdAt: string; paymentFingerprint?: string };
const ACCEPTANCE_STORAGE_PREFIX = 'libereal:pending-acceptance:';

function acceptanceStorageKey(snapshot: AcceptanceSnapshot) {
  return `${ACCEPTANCE_STORAGE_PREFIX}${encodeURIComponent(snapshot.actorScope)}:${snapshot.inquiryId}:${snapshot.quoteId}:v${snapshot.quoteVersion}:${snapshot.itemIds.join(',')}:${snapshot.quantities.join(',')}`;
}
function validAcceptanceSnapshot(snapshot: AcceptanceSnapshot, items: InquiryItem[]) {
  return Array.isArray(snapshot.itemIndices) && Array.isArray(snapshot.itemIds) && Array.isArray(snapshot.quantities)
    && snapshot.itemIndices.length > 0 && snapshot.itemIndices.length === snapshot.itemIds.length && snapshot.itemIndices.length === snapshot.quantities.length
    && snapshot.itemIndices.every((idx, n) => Number.isInteger(idx) && idx >= 0 && idx < items.length && snapshot.itemIds[n] === (items[idx].id ?? String(idx)) && Number.isInteger(snapshot.quantities[n]) && snapshot.quantities[n] > 0)
    && new Set(snapshot.itemIndices).size === snapshot.itemIndices.length && Array.isArray(snapshot.acceptedLegalIds) && snapshot.acceptedLegalIds.every((id) => typeof id === 'string')
    && typeof snapshot.actorScope === 'string' && snapshot.actorScope.length > 0 && typeof snapshot.attemptId === 'string' && snapshot.attemptId.length > 0;
}

function removeAcceptanceSnapshots(inquiryId: string) {
  if (typeof window === 'undefined') return;
  for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
    const key = window.sessionStorage.key(i);
    if (key?.includes(`:${inquiryId}:`)) { try { window.sessionStorage.removeItem(key); } catch {} }
  }
}

const LINKED_ORDER_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: uiSurfaces.badgeWarning },
  confirmed: { label: '已确认', color: uiSurfaces.badgeInfo },
  shipped: { label: '已发货', color: uiSurfaces.badgeInfo },
  completed: { label: '已完成', color: uiSurfaces.badgeSuccess },
};

export default function InquiriesPanel() {
  const router = useRouter();
  const { data: session } = useSession();
  const actorRole = session?.user?.role;
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [acceptanceAttempts, setAcceptanceAttempts] = useState<Record<string, AcceptanceSnapshot>>({});
  const acceptanceAttemptsRef = useRef<Record<string, AcceptanceSnapshot>>({});
  const [submitting, setSubmitting] = useState(false);
  const [quotePaymentMethod, setQuotePaymentMethod] = useState('');
  const [personalPoints, setPersonalPoints] = useState(0);
  const [groupPoints, setGroupPoints] = useState(0);
  const [showDecline, setShowDecline] = useState(false);
  const pointsBalance = useCheckoutPointsBalance();
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<number>>>({});
  const [editedQuantities, setEditedQuantities] = useState<Record<string, Record<number, number>>>({});
  const [inquiryOrders, setInquiryOrders] = useState<Record<string, LinkedOrder[]>>({});
  const actorScope = useCallback((inq: Inquiry) => `${session?.user?.id || session?.user?.email || 'unknown'}:${inq.ownerScope || 'personal'}:${inq.organizationId || ''}`, [session?.user?.id, session?.user?.email]);

  const fetchInquiries = useCallback(async (preserveSelection = true) => {
    setLoading(true);
    try {
      const res = await fetch('/api/my-orders');
      const data = await res.json();
      const freshInquiries: Inquiry[] = data.inquiries || [];
      setInquiries(freshInquiries);
      if (typeof window !== 'undefined') {
        freshInquiries.forEach((inq) => {
          const quote = inq.activeQuote;
          if (!quote || acceptanceAttemptsRef.current[inq.id]) return;
          for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
            const key = window.sessionStorage.key(i);
            if (!key?.startsWith(ACCEPTANCE_STORAGE_PREFIX) || !key.includes(`:${inq.id}:`)) continue;
            try {
              const snapshot = JSON.parse(window.sessionStorage.getItem(key) || '') as AcceptanceSnapshot;
              if (snapshot.quoteId === quote.id && snapshot.quoteVersion === quote.version && snapshot.actorScope === actorScope(inq) && validAcceptanceSnapshot(snapshot, quote.items)) {
                acceptanceAttemptsRef.current[inq.id] = snapshot;
                setAcceptanceAttempts((prev) => ({ ...prev, [inq.id]: snapshot }));
                setSelectedItems((prev) => ({ ...prev, [inq.id]: new Set(snapshot.itemIndices) }));
                setEditedQuantities((prev) => ({ ...prev, [inq.id]: Object.fromEntries(snapshot.itemIndices.map((idx, n) => [idx, snapshot.quantities[n]])) }));
                break;
              }
            } catch { try { window.sessionStorage.removeItem(key); } catch {} }
          }
        });
      }

      const ordersMap: Record<string, LinkedOrder[]> = {};
      const inqsWithOrders = freshInquiries.filter((inq) => (inq.orderCount || 0) > 0);
      await Promise.all(inqsWithOrders.map(async (inq) => {
        try {
          const r = await fetch(`/api/orders/${inq.id}/confirm-items`);
          if (r.ok) {
            const d = await r.json();
            ordersMap[inq.id] = d.orders || [];
          }
        } catch {}
      }));
      setInquiryOrders(ordersMap);

      if (preserveSelection) {
        setSelectedInquiry(prev => {
          if (!prev) return prev;
          const updated = freshInquiries.find((o) => o.id === prev.id);
          return updated || null;
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [actorScope]);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  function toggleItem(inquiryId: string, idx: number) {
    setSelectedItems(prev => {
      const copy = { ...prev };
      if (!copy[inquiryId]) copy[inquiryId] = new Set();
      const set = new Set(copy[inquiryId]);
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      copy[inquiryId] = set;
      return copy;
    });
  }

  function selectAll(inquiryId: string, items: InquiryItem[]) {
    if (acceptanceAttemptsRef.current[inquiryId]) return;
    const selectableIndices = items
      .map((item, idx) => {
        if (item.ordered || item.available === false || (item.orderedQty ?? 0) >= (item.quantity || 1)) return -1;
        const isQ = item.isQuickOrder;
        const p = isQ
          ? item.price
          : (item.price ?? item.product?.promotionalPrice ?? item.product?.price);
        return p != null ? idx : -1;
      })
      .filter(idx => idx >= 0);
    setSelectedItems(prev => ({
      ...prev,
      [inquiryId]: new Set(selectableIndices),
    }));
  }

  function clearSelection(inquiryId: string, force = false) {
    if (acceptanceAttemptsRef.current[inquiryId] && !force) return;
    setSelectedItems(prev => {
      const copy = { ...prev };
      delete copy[inquiryId];
      return copy;
    });
    setEditedQuantities(prev => {
      const copy = { ...prev };
      delete copy[inquiryId];
      return copy;
    });
    delete acceptanceAttemptsRef.current[inquiryId];
    removeAcceptanceSnapshots(inquiryId);
    setAcceptanceAttempts(prev => { const next = { ...prev }; delete next[inquiryId]; return next; });
  }

  function getItemQty(inquiryId: string, idx: number, defaultQty: number) {
    return editedQuantities[inquiryId]?.[idx] ?? defaultQty;
  }

  function setItemQty(inquiryId: string, idx: number, qty: number) {
    setEditedQuantities(prev => {
      const copy = { ...prev };
      if (!copy[inquiryId]) copy[inquiryId] = {};
      copy[inquiryId][idx] = qty;
      return { ...copy };
    });
  }

  async function submitOrder(inquiryId: string, itemIndices: number[], acceptedLegalIds: string[]) {
    if (itemIndices.length === 0) return;
    setSubmitting(true);
    try {
      const quantities = editedQuantities[inquiryId] || {};
      const quote = inquiries.find((inq) => inq.id === inquiryId)?.activeQuote;
      if (!quote) return;
      const quantityVector = itemIndices.map((idx) => quantities[idx] ?? remainingQuantity(quote.items[idx]));
      const requestQuantities = Object.fromEntries(itemIndices.map((idx, n) => [idx, quantityVector[n]]));
      const currentAttempt = acceptanceAttemptsRef.current[inquiryId];
      const normalizedLegalIds = [...new Set(acceptedLegalIds)].sort();
      const settlement = quoteConfirmSettlementFields({
        actorRole,
        paymentMethod: quotePaymentMethod,
        personalPoints,
        groupPoints,
        groupId: pointsBalance?.group?.usable ? pointsBalance.group.id : undefined,
      });
      const groupId = settlement.groupId ?? '';
      const paymentFingerprint = JSON.stringify({ method: settlement.paymentMethod, personalPoints: settlement.personalPoints, groupPoints: settlement.groupPoints, groupId });
      const matches = currentAttempt
        && currentAttempt.quoteId === quote.id && currentAttempt.quoteVersion === quote.version
        && JSON.stringify(currentAttempt.itemIndices) === JSON.stringify(itemIndices)
        && JSON.stringify(currentAttempt.quantities) === JSON.stringify(quantityVector)
        && JSON.stringify(currentAttempt.acceptedLegalIds) === JSON.stringify(normalizedLegalIds)
        && currentAttempt.paymentFingerprint === paymentFingerprint;
      const attemptId = matches ? currentAttempt.attemptId : `quote-${inquiryId}-${quote.id}-${quote.version}-${crypto.randomUUID()}`;
      if (!matches) {
        const attempt = { inquiryId, quoteId: quote.id, quoteVersion: quote.version, itemIndices: [...itemIndices], itemIds: itemIndices.map((idx) => quote.items[idx]?.id ?? String(idx)), quantities: [...quantityVector], acceptedLegalIds: normalizedLegalIds, actorScope: actorScope(inquiries.find((inq) => inq.id === inquiryId) || ({ ownerScope: 'personal' } as Inquiry)), attemptId, createdAt: new Date().toISOString(), paymentFingerprint };
        removeAcceptanceSnapshots(inquiryId);
        try { window.sessionStorage.setItem(acceptanceStorageKey(attempt), JSON.stringify(attempt)); } catch {}
        acceptanceAttemptsRef.current[inquiryId] = attempt;
        setAcceptanceAttempts(prev => ({ ...prev, [inquiryId]: attempt }));
      }
      const res = await fetch(`/api/orders/${inquiryId}/confirm-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptId },
        body: JSON.stringify({
          itemIndices,
          quantities: requestQuantities,
          quoteId: quote.id,
          quoteVersion: quote.version,
          acceptanceAttemptId: attemptId,
          acceptedLegalIds,
          paymentMethod: settlement.paymentMethod || undefined,
          personalPoints: settlement.personalPoints,
          groupPoints: settlement.groupPoints,
          groupId: settlement.groupId,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { orderId?: string };
        setShowConfirmModal(false);
        delete acceptanceAttemptsRef.current[inquiryId];
        setAcceptanceAttempts(prev => { const next = { ...prev }; delete next[inquiryId]; return next; });
        clearSelection(inquiryId, true);
        if (data.orderId && quotePaymentMethod === 'alipay') {
          try {
            await startAlipayCheckout(data.orderId);
            return;
          } catch (payError) {
            alert(payError instanceof Error ? payError.message : '支付宝支付创建失败');
          }
        }
        if (data.orderId) router.push(`/account/orders/${encodeURIComponent(data.orderId)}`);
        else await fetchInquiries();
      } else {
        const err = await res.json();
        const code = typeof err.code === 'string' ? err.code : null;
        if (code === 'QUOTE_STALE' || code === 'QUOTE_EXPIRED' || code === 'QUOTE_NOT_ACTIONABLE' || code === 'QUOTE_VERSION_CONFLICT' || res.status === 400 || res.status === 409) {
          await fetchInquiries();
        }
          alert(code ? `${err.error || '报价状态已变化'} 请刷新后重新核对。` : (res.status === 400 || res.status === 409 ? `${err.detail || err.error || '报价状态已变化'} 请刷新后重新核对。` : (err.detail || err.error || '提交失败')));
      }
    } catch (e) {
      console.error(e);
      alert('提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  const quoteSentCount = inquiries.filter((inquiry) => customerCanAcceptQuote({
    inquiryStatus: inquiry.status,
    quote: inquiry.activeQuote,
  })).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-[var(--brand-border-radius-pill)] border-2 border-[var(--brand-color-primary)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-[var(--brand-border-radius-lg)] p-4 ${uiSurfaces.panelStrong}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className={uiSurfaces.textInteractive} size={22} />
            <div>
              <h2 className={`text-lg font-bold ${uiSurfaces.titleText}`}>我的询价</h2>
              <p className={`text-xs ${uiSurfaces.mutedText}`}>管理您的询价记录</p>
            </div>
          </div>
          {quoteSentCount > 0 && (
            <span className={`${uiSurfaces.badgeWarning} min-h-0 px-3 py-1 text-xs`}>
              {quoteSentCount} 条新报价待确认
            </span>
          )}
        </div>
      </div>

      {inquiries.length === 0 ? (
        <div className={`rounded-[var(--brand-border-radius-lg)] p-12 text-center ${uiSurfaces.panel}`}>
          <Package className={`mx-auto mb-4 h-12 w-12 ${uiSurfaces.textQuaternary}`} />
          <p className={uiSurfaces.mutedText}>暂无询价记录</p>
        </div>
      ) : (
        <div className="space-y-4">
          {inquiries.map(inquiry => {
            const quoteExpired = Boolean(inquiry.activeQuote && quoteIsExpired(inquiry.activeQuote));
            const quoteOpen = customerCanAcceptQuote({ inquiryStatus: inquiry.status, quote: inquiry.activeQuote });
            const statusCfg = STATUS_CONFIG[effectiveInquiryStatus(inquiry.status, inquiry.activeQuote)] || STATUS_CONFIG['pending_quote'];
            const items = parseItems(inquiry.activeQuote?.items ?? inquiry.items);
            const linkedOrders = inquiryOrders[inquiry.id] || [];

            return (
              <div key={inquiry.id} className={`overflow-hidden rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panel}`}>
                <div
                  className="p-6 cursor-pointer"
                  onClick={() => setSelectedInquiry(selectedInquiry?.id === inquiry.id ? null : inquiry)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <InquiryIdDisplay id={inquiry.id} className={uiSurfaces.titleText} />
                        <span className={`${statusCfg.color} min-h-0 px-2 py-0.5 text-xs font-medium`}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <p className={`text-xs ${uiSurfaces.mutedText}`}>{new Date(inquiry.createdAt).toLocaleDateString('zh-CN')}</p>
                      <p className={`mt-1 text-sm ${uiSurfaces.textSecondary}`}>{inquiry.institution}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${uiSurfaces.textInteractive}`}>{inquiry.hasUnresolvedPricing ? '待报价确认' : formatPrice(inquiry.activeQuote?.subtotal ?? inquiry.subtotal)}</p>
                      <p className={`text-xs ${uiSurfaces.mutedText}`}>{inquiry.hasUnresolvedPricing ? '已知价仅作部分小计' : `${items.length} 种产品`}</p>
                    </div>
                  </div>
                </div>

                {selectedInquiry?.id === inquiry.id && (
                  <div className={`space-y-3 border-t p-6 ${uiSurfaces.border} bg-[var(--surface-muted)]`}>
                    {quoteExpired && inquiry.activeQuote && (
                      <div className="rounded-[var(--brand-border-radius)] border border-amber-200 bg-amber-50 p-4">
                        <div className="mb-2 flex items-center gap-2 text-amber-800">
                          <Clock className="w-5 h-5" />
                          <p className="font-medium">报价已过期</p>
                        </div>
                        <p className="text-sm text-amber-800/80">
                          报价版本：v{inquiry.activeQuote.version} · 有效期：{inquiry.activeQuote.validUntil ? new Date(inquiry.activeQuote.validUntil).toLocaleString('zh-CN') : '未提供'}
                        </p>
                      </div>
                    )}

                    {quoteOpen && inquiry.activeQuote && (
                      <div className="rounded-[var(--brand-border-radius)] border border-[var(--brand-color-success-border)] bg-[var(--brand-color-success-bg)] p-4">
                        <div className="mb-2 flex items-center gap-2 text-[var(--brand-color-success-text)]">
                          <FileText className="w-5 h-5" />
                          <p className="font-medium">您的询价已收到报价</p>
                        </div>
                        <p className="text-sm text-[var(--brand-color-success-text)]">
                          报价版本：v{inquiry.activeQuote.version} · 报价时间：{inquiry.activeQuote.sentAt ? new Date(inquiry.activeQuote.sentAt).toLocaleString('zh-CN') : '-'}
                        </p>
                      </div>
                    )}

                    {linkedOrders.length > 0 && (
                      <div>
                        <p className={`mb-2 text-sm font-medium ${uiSurfaces.titleText}`}>已生成的订单</p>
                        <div className="space-y-2">
                          {linkedOrders.map(order => {
                            const statusInfo = LINKED_ORDER_STATUS[order.status] || { label: order.status, color: uiSurfaces.badge };
                            return (
                              <Link
                                key={order.id}
                                href={`/account/orders/${encodeURIComponent(order.id)}`}
                                className={`flex items-center justify-between rounded-[var(--brand-border-radius)] border border-[var(--brand-color-info-border)] bg-[var(--brand-color-info-bg)] p-3 transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}
                              >
                                <div className="flex items-center gap-2">
                                  <Package className="h-4 w-4 text-[var(--brand-color-info-text)]" />
                                  <span className="font-mono text-sm text-[var(--brand-color-info-text)]">{order.id}</span>
                                  <span className={`${statusInfo.color} min-h-0 px-2 py-0.5 text-xs font-medium`}>
                                    {statusInfo.label}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-bold text-[var(--brand-color-info-text)]">{formatPrice(order.subtotal)}</span>
                                  <ExternalLink className="h-4 w-4 text-[var(--brand-color-info-text)]" />
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {quoteOpen && (
                      <div className="flex items-center justify-between">
                        <p className={`text-sm font-medium ${uiSurfaces.titleText}`}>
                          选择产品生成订单（已选 {selectedItems[inquiry.id]?.size || 0} 种）
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); selectAll(inquiry.id, items); }}
                            className={`text-xs underline ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${uiSurfaces.focusRing}`}
                          >
                            全选
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); clearSelection(inquiry.id); }}
                            className={`text-xs underline ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${uiSurfaces.focusRing}`}
                          >
                            清除
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {items.map((item, i) => {
                        // 支持两种数据结构：
                        // 1. 平铺结构（来自 /api/inquiry 创建的询价单）：{name, brand, catalogNumber, price, quantity, customerLeadTime, actualLeadTime, ...}
                        // 2. 嵌套结构（来自产品列表/快速下单）：{isQuickOrder, name?, product: {name, brand, ...} | null}
                        const isQuick = item.isQuickOrder;
                        const productInfo = (item.product && typeof item.product === 'object') ? item.product : null;
                        const name = isQuick ? item.name : (item.name || productInfo?.name);
                        const brand = isQuick ? item.brand : (item.brand || productInfo?.brand);
                        const catNum = isQuick ? item.catalogNumber : (item.catalogNumber || productInfo?.catalogNumber);
                        const price = isQuick
                          ? item.price
                          : (item.price ?? productInfo?.promotionalPrice ?? productInfo?.price);
                        const qty = item.quantity || 1;
                        const quotedQty = qty;
                        const alreadyAccepted = Math.min(quotedQty, item.orderedQty ?? (item.ordered ? quotedQty : 0));
                        const remaining = Math.max(0, quotedQty - alreadyAccepted);
                        const leadTime = item.actualLeadTime || item.customerLeadTime || item.leadTime;
                        const isOrdered = remaining === 0;
                        const isSelected = selectedItems[inquiry.id]?.has(i) || false;
                        const canEdit = quoteOpen && price != null && remaining > 0 && item.available !== false && !item.locked;
                        const canSelect = canEdit;
                        const finalQty = getItemQty(inquiry.id, i, remaining);
                        const subtotal = (price || 0) * finalQty;
                        const needsQuote = !price || price === 0;

                        return (
                          <div
                            key={i}
                            className={`rounded-[var(--brand-border-radius)] border transition-colors ${uiSurfaces.panel} ${
                              canSelect ? 'cursor-pointer' : ''
                            } ${
                              isOrdered ? 'border-[var(--surface-border-muted)] bg-[var(--surface-disabled)] opacity-70' :
                              isSelected ? 'border-[var(--brand-color-primary-border-hover)] bg-[var(--brand-color-primary-bg)]' : ''
                            }`}
                            onClick={() => canSelect && !acceptanceAttempts[inquiry.id] ? toggleItem(inquiry.id, i) : undefined}
                          >
                            <div className="p-4 flex items-center gap-3">
                              {canSelect && (
                                <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[var(--brand-border-radius-sm)] border-2 transition-colors ${
                                  isSelected ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary)]' : 'border-[var(--surface-border)]'
                                }`}>
                                  {isSelected && <Check className="h-3 w-3 text-[var(--brand-color-text-on-primary)]" />}
                                </div>
                              )}

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className={`truncate text-sm font-medium ${uiSurfaces.titleText}`}>{name || '未知产品'}</p>
                                  {isOrdered && (
                                    <span className={`${uiSurfaces.badge} min-h-0 whitespace-nowrap px-2 py-0.5 text-xs font-medium`}>
                                      已转订单
                                    </span>
                                  )}
                                  {needsQuote && !isOrdered && (
                                    <span className={`${uiSurfaces.badgeWarning} min-h-0 whitespace-nowrap px-2 py-0.5 text-xs font-medium`}>
                                      待报价
                                    </span>
                                  )}
                                </div>
                                <p className={`mt-0.5 truncate text-xs ${uiSurfaces.textQuaternary}`}>{brand} · {catNum}</p>
                              </div>

                              <div className="text-right flex-shrink-0">
                                {needsQuote ? (
                                  <p className="text-sm font-semibold text-[var(--brand-color-warning-text)]">待报价</p>
                                ) : (
                                  <p className={`text-sm font-semibold ${uiSurfaces.titleText}`}>{formatPrice(subtotal)}</p>
                                )}
                                <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>×{finalQty}</p>
                              </div>
                            </div>

                            <div className={`grid grid-cols-4 gap-3 border-t px-4 pb-4 pt-3 text-sm ${uiSurfaces.border}`}>
                              <div>
                                <p className={`mb-1 text-xs ${uiSurfaces.mutedText}`}>单价</p>
                                <p className={`font-medium ${needsQuote ? 'text-[var(--brand-color-warning-text)]' : uiSurfaces.textInteractive}`}>
                                  {needsQuote ? '待报价' : formatPrice(price)}
                                </p>
                              </div>
                              <div>
                                <p className={`mb-1 text-xs ${uiSurfaces.mutedText}`}>数量</p>
                                {canEdit ? (
                                  <QuoteQuantityEditor
                                    quotedQuantity={quotedQty}
                                    orderedQty={alreadyAccepted}
                                    minQuantity={item.minQuantity}
                                    quantityStep={item.quantityStep}
                                    value={finalQty}
                                    disabled={Boolean(acceptanceAttempts[inquiry.id])}
                                    onChange={(qty) => setItemQty(inquiry.id, i, qty)}
                                    className={`w-20 px-2 text-sm font-medium ${uiSurfaces.inputCompact} ${uiSurfaces.focusRing}`}
                                  />
                                ) : (
                                  <p className={`font-medium ${uiSurfaces.textSecondary}`}>{finalQty}</p>
                                )}
                              </div>
                              <div>
                                <p className={`mb-1 text-xs ${uiSurfaces.mutedText}`}>接受情况</p>
                                <p className={`text-xs font-medium ${uiSurfaces.textSecondary}`}>报价 {quotedQty} · 已接受 {alreadyAccepted} · 剩余 {remaining}</p>
                              </div>
                              <div>
                                <p className={`mb-1 text-xs ${uiSurfaces.mutedText}`}>货期</p>
                                <p className={`text-xs font-medium ${uiSurfaces.textSecondary}`}>{leadTime || '-'}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {quoteExpired && inquiry.activeQuote && (
                      <div className={`mt-4 border-t pt-4 ${uiSurfaces.border}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className={`text-sm ${uiSurfaces.textSecondary}`}>报价已过期，不能再接受。可以放弃该报价，或等待重新报价。</p>
                          <button
                            type="button"
                            data-testid="decline-quote-button"
                            onClick={(e) => { e.stopPropagation(); setSelectedInquiry(inquiry); setShowDecline(true); }}
                            className="min-h-11 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 sm:w-auto"
                          >
                            放弃
                          </button>
                        </div>
                      </div>
                    )}

                    {(quoteOpen || acceptanceAttempts[inquiry.id]) && (
                      <div className={`mt-4 border-t pt-4 ${uiSurfaces.border}`}>
                        {(() => {
                          const selId = selectedItems[inquiry.id];
                          const selCount = selId?.size || 0;
                          const selected = items.map((item, idx) => ({ item, idx })).filter(({ idx }) => selId?.has(idx));
                          const selQty = selected.reduce((sum, { item, idx }) => sum + getItemQty(inquiry.id, idx, remainingQuantity(item)), 0);
                          const selTotal = selCount > 0 ? selected
                            .reduce((sum, { item, idx }) => {
                              const p = item.price ?? (item.product?.promotionalPrice ?? item.product?.price);
                              return sum + (p || 0) * getItemQty(inquiry.id, idx, remainingQuantity(item));
                            }, 0) : 0;

                          return (
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className={`font-medium ${uiSurfaces.titleText}`}>已选产品小计</p>
                                <p className={`text-xl font-bold ${uiSurfaces.textInteractive}`}>{formatPrice(selTotal)}</p>
                                {selCount > 0 && <p className={`text-xs ${uiSurfaces.mutedText}`}>本次接受 {selQty} 件 · {selCount} 种产品</p>}
                              </div>
                              <div className="flex items-center gap-3">
                                {selCount > 0 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); clearSelection(inquiry.id); }}
                                    className={`text-sm underline ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${uiSurfaces.focusRing}`}
                                  >
                                    清除选择
                                  </button>
                                )}
                                {inquiry.activeQuote?.status === 'sent' && items.every((line) => (line.orderedQty ?? (line.ordered ? line.quantity || 1 : 0)) === 0) && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSelectedInquiry(inquiry); setShowDecline(true); }}
                                    className={`text-sm underline ${uiSurfaces.textSecondary}`}
                                  >
                                    放弃报价
                                  </button>
                                )}
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowConfirmModal(true); }}
                                  disabled={selCount === 0}
                                  className={`${uiSurfaces.buttonPrimary} px-6 text-sm`}
                                >
                                  确认提交订单 ({selCount})
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showConfirmModal && selectedInquiry && (() => {
        const items = parseItems(selectedInquiry.activeQuote?.items ?? selectedInquiry.items);
        const selId = selectedItems[selectedInquiry.id];
        const selItems = items.map((item, idx) => ({ item, idx })).filter(({ idx }) => selId?.has(idx));
        const selTotal = selItems.reduce((sum, { item, idx }) => {
          return sum + (item.price || 0) * getItemQty(selectedInquiry.id, idx, remainingQuantity(item));
        }, 0);
        const settlement = quoteConfirmSettlementFields({
          actorRole,
          paymentMethod: quotePaymentMethod,
          personalPoints,
          groupPoints,
          groupId: pointsBalance?.group?.usable ? pointsBalance.group.id : undefined,
        });
        const payable = describeCheckoutPayable({
          goodsSubtotal: selTotal,
          paymentMethod: quotePaymentMethod,
          personalPoints: settlement.personalPoints,
          groupPoints: settlement.groupPoints,
        });
        const quantityNudges = findQuoteQuantityNudges(selItems.map(({ item, idx }) => ({
          key: item.id || String(idx),
          name: item.name,
          catalogNumber: item.catalogNumber,
          quantity: getItemQty(selectedInquiry.id, idx, remainingQuantity(item)),
          category: item.category,
          subcategory: item.subcategory,
          type: item.type,
        })));

        return (
          <div className={`fixed inset-0 z-site-overlay flex justify-center overflow-y-auto px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))] ${uiSurfaces.modalBackdrop}`}>
            <div className={`mx-4 my-4 w-full max-w-2xl rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal} p-6`}>
              <h3 className={`mb-2 text-lg font-bold ${uiSurfaces.titleText}`}>确认提交订单</h3>
              <p className={`mb-4 text-sm ${uiSurfaces.textSecondary}`}>
                {actorRole === 'admin'
                  ? `你正在代客户接受报价 v${selectedInquiry.activeQuote?.version}。请核对报价编号、商品、规格、数量与金额。本次选择将转为独立订单。数量可以多于报价，按报价单价计。积分由客户在结算时自行选择，此处不能代扣。`
                  : `你正在接受报价 v${selectedInquiry.activeQuote?.version}。确认前请核对报价编号、商品、规格、数量与金额；本次选择将转为独立订单。数量可以多于报价，按报价单价计。积分可与支付宝或其他付款方式组合抵扣。`}
              </p>
              <QuoteQuantityNudgeNotice nudges={quantityNudges} />
              <QuoteAcceptancePreview lines={selItems.map(({ item, idx }) => ({
                name: item.name || item.product?.name || '产品',
                quotedQuantity: item.quantity || 1,
                quantity: getItemQty(selectedInquiry.id, idx, remainingQuantity(item)),
                unitPrice: item.price || 0,
              }))} />
              <CheckoutPaymentFields
                paymentMethod={quotePaymentMethod}
                onPaymentMethodChange={setQuotePaymentMethod}
                personalPoints={settlement.personalPoints}
                onPersonalPointsChange={setPersonalPoints}
                groupPoints={settlement.groupPoints}
                onGroupPointsChange={setGroupPoints}
                pointsBalance={pointsBalance}
                pointsDiscount={payable.pointsDiscount}
                showPointsSection={actorRole !== 'admin'}
                compact
              />
              <div className="mb-4 rounded-[var(--brand-border-radius)] bg-[var(--brand-color-primary-bg)] p-3">
                <p className={`text-sm ${uiSurfaces.textInteractive}`}>
                  报价 {selectedInquiry.activeQuote?.id} · 商品 {formatPrice(selTotal)} · 应付 <span className="font-bold">{formatPrice(payable.payable)}</span>
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className={`${uiSurfaces.buttonGhost} flex-1 text-sm`}
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    setShowConfirmModal(false);
                    setShowLegalModal(true);
                  }}
                  disabled={submitting || !quotePaymentMethod}
                  className={`${uiSurfaces.buttonPrimary} flex-1 text-sm`}
                >
                  {submitting ? '提交中...' : '确认提交'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showDecline && selectedInquiry?.activeQuote && (
        <DeclineQuoteDialog
          inquiryId={selectedInquiry.id}
          quoteId={selectedInquiry.activeQuote.id}
          quoteVersion={selectedInquiry.activeQuote.version}
          onClose={() => setShowDecline(false)}
          onDeclined={() => { setShowDecline(false); void fetchInquiries(); }}
        />
      )}

      <LegalConsentModal
        open={showLegalModal}
        onClose={() => setShowLegalModal(false)}
        onConfirm={async (acceptedIds) => {
          setShowLegalModal(false);
          if (selectedInquiry) {
            const persistedLegalIds = acceptanceAttemptsRef.current[selectedInquiry.id]?.acceptedLegalIds;
            await submitOrder(selectedInquiry.id, selectedItems[selectedInquiry.id] ? Array.from(selectedItems[selectedInquiry.id]) : [], persistedLegalIds !== undefined ? persistedLegalIds : acceptedIds);
          }
        }}
        submitting={submitting}
      />
    </div>
  );
}
