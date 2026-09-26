'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Package, FileText, Check, Clock, ExternalLink } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface InquiryItem {
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
  price?: number;
  unit?: string;
  leadTime?: string;
  customerLeadTime?: string | null;
  actualLeadTime?: string | null;
  available?: boolean | null;
  ordered?: boolean;
  locked?: boolean;
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
  status: string;
  createdAt: string;
  activeQuote?: { status: string; sentAt?: string; acceptedAt?: string; items: InquiryItem[] } | null;
  orderCount?: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  'pending_quote': { label: '待报价', color: uiSurfaces.badgeWarning, icon: Clock },
  'quote_sent': { label: '已报价', color: uiSurfaces.badgeSuccess, icon: FileText },
  'closed': { label: '待报价', color: uiSurfaces.badgeWarning, icon: Clock },
};

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
};

function parseItems(items: InquiryItem[]): InquiryItem[] { return items; }

const LINKED_ORDER_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: uiSurfaces.badgeWarning },
  confirmed: { label: '已确认', color: uiSurfaces.badgeInfo },
  shipped: { label: '已发货', color: uiSurfaces.badgeInfo },
  completed: { label: '已完成', color: uiSurfaces.badgeSuccess },
};

export default function InquiriesPanel() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<number>>>({});
  const [editedQuantities, setEditedQuantities] = useState<Record<string, Record<number, number>>>({});
  const [inquiryOrders, setInquiryOrders] = useState<Record<string, LinkedOrder[]>>({});

  const fetchInquiries = useCallback(async (preserveSelection = true) => {
    setLoading(true);
    try {
      const res = await fetch('/api/my-orders');
      const data = await res.json();
      const freshInquiries: Inquiry[] = data.inquiries || [];
      setInquiries(freshInquiries);

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
  }, []);

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
    const selectableIndices = items
      .map((item, idx) => {
        if (item.ordered) return -1;
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

  function clearSelection(inquiryId: string) {
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

  async function submitOrder(inquiryId: string, itemIndices: number[]) {
    if (itemIndices.length === 0) return;
    setSubmitting(true);
    try {
      const quantities = editedQuantities[inquiryId] || {};
      const res = await fetch(`/api/orders/${inquiryId}/confirm-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIndices, quantities }),
      });
      if (res.ok) {
        setShowConfirmModal(false);
        clearSelection(inquiryId);
        await fetchInquiries();
      } else {
        const err = await res.json();
        alert(err.detail || err.error || '提交失败');
      }
    } catch (e) {
      console.error(e);
      alert('提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  const quoteSentCount = inquiries.filter(i => i.activeQuote?.status === 'sent').length;

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
            const statusCfg = STATUS_CONFIG[inquiry.status] || STATUS_CONFIG['pending_quote'];
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
                        <span className={`text-sm font-medium ${uiSurfaces.titleText}`}>{inquiry.id.slice(0, 16)}...</span>
                        <span className={`${statusCfg.color} min-h-0 px-2 py-0.5 text-xs font-medium`}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <p className={`text-xs ${uiSurfaces.mutedText}`}>{new Date(inquiry.createdAt).toLocaleDateString('zh-CN')}</p>
                      <p className={`mt-1 text-sm ${uiSurfaces.textSecondary}`}>{inquiry.institution}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${uiSurfaces.textInteractive}`}>{formatPrice(inquiry.subtotal)}</p>
                      <p className={`text-xs ${uiSurfaces.mutedText}`}>{items.length} 种产品</p>
                    </div>
                  </div>
                </div>

                {selectedInquiry?.id === inquiry.id && (
                  <div className={`space-y-3 border-t p-6 ${uiSurfaces.border} bg-[var(--surface-muted)]`}>
                    {/* Quote received banner */}
                    {inquiry.activeQuote?.status === 'sent' && (
                      <div className="rounded-[var(--brand-border-radius)] border border-[var(--brand-color-success-border)] bg-[var(--brand-color-success-bg)] p-4">
                        <div className="mb-2 flex items-center gap-2 text-[var(--brand-color-success-text)]">
                          <FileText className="w-5 h-5" />
                          <p className="font-medium">您的询价已收到报价</p>
                        </div>
                        <p className="text-sm text-[var(--brand-color-success-text)]">
                          报价时间：{inquiry.activeQuote.sentAt ? new Date(inquiry.activeQuote.sentAt).toLocaleString('zh-CN') : '-'}
                        </p>
                      </div>
                    )}

                    {/* Linked Orders */}
                    {linkedOrders.length > 0 && (
                      <div>
                        <p className={`mb-2 text-sm font-medium ${uiSurfaces.titleText}`}>已生成的订单</p>
                        <div className="space-y-2">
                          {linkedOrders.map(order => {
                            const statusInfo = LINKED_ORDER_STATUS[order.status] || { label: order.status, color: uiSurfaces.badge };
                            return (
                              <Link
                                key={order.id}
                                href="/account/orders"
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

                    {/* Product selection controls */}
                    {inquiry.activeQuote?.status === 'sent' && (
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

                    {/* Products */}
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
                        const leadTime = item.actualLeadTime || item.customerLeadTime || item.leadTime;
                        const isOrdered = !!item.ordered;
                        const isSelected = selectedItems[inquiry.id]?.has(i) || false;
                        const canEdit = inquiry.activeQuote?.status === 'sent' && price != null && !isOrdered && !item.locked;
                        const canSelect = canEdit;
                        const finalQty = getItemQty(inquiry.id, i, qty);
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
                            onClick={() => canSelect ? toggleItem(inquiry.id, i) : undefined}
                          >
                            {/* 顶部：复选框 + 产品名 + 状态徽章 */}
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

                            {/* 底部：单价 / 数量 / 货期 三栏 */}
                            <div className={`grid grid-cols-3 gap-3 border-t px-4 pb-4 pt-3 text-sm ${uiSurfaces.border}`}>
                              <div>
                                <p className={`mb-1 text-xs ${uiSurfaces.mutedText}`}>单价</p>
                                <p className={`font-medium ${needsQuote ? 'text-[var(--brand-color-warning-text)]' : uiSurfaces.textInteractive}`}>
                                  {needsQuote ? '待报价' : formatPrice(price)}
                                </p>
                              </div>
                              <div>
                                <p className={`mb-1 text-xs ${uiSurfaces.mutedText}`}>数量</p>
                                {canEdit ? (
                                  <input
                                    type="number"
                                    min="1"
                                    value={finalQty}
                                    onChange={e => {
                                      e.stopPropagation();
                                      setItemQty(inquiry.id, i, parseInt(e.target.value) || 1);
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    className={`w-16 px-2 text-sm font-medium ${uiSurfaces.inputCompact} ${uiSurfaces.focusRing}`}
                                  />
                                ) : (
                                  <p className={`font-medium ${uiSurfaces.textSecondary}`}>{finalQty}</p>
                                )}
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

                    {/* Bottom: Submit selected items as order */}
                    {inquiry.activeQuote?.status === 'sent' && (
                      <div className={`mt-4 border-t pt-4 ${uiSurfaces.border}`}>
                        {(() => {
                          const selId = selectedItems[inquiry.id];
                          const selCount = selId?.size || 0;
                          const selTotal = selCount > 0 ? items
                            .filter((_, idx) => selId?.has(idx))
                            .reduce((sum, item, itemIdx) => {
                              const isQ = item.isQuickOrder;
                              const p = isQ
                                ? item.price
                                : (item.price ?? item.product?.promotionalPrice ?? item.product?.price);
                              return sum + (p || 0) * getItemQty(inquiry.id, itemIdx, item.quantity || 1);
                            }, 0) : 0;

                          return (
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className={`font-medium ${uiSurfaces.titleText}`}>已选产品小计</p>
                                <p className={`text-xl font-bold ${uiSurfaces.textInteractive}`}>{formatPrice(selTotal)}</p>
                                {selCount > 0 && <p className={`text-xs ${uiSurfaces.mutedText}`}>已选 {selCount} 种产品</p>}
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

      {/* Confirm Submit Modal */}
      {showConfirmModal && selectedInquiry && (() => {
        const items = parseItems(selectedInquiry.activeQuote?.items ?? selectedInquiry.items);
        const selId = selectedItems[selectedInquiry.id];
        const selIndices = selId ? Array.from(selId) : [];
        const selItems = items.filter((_, idx) => selId?.has(idx));
        const selTotal = selItems.reduce((sum, item, itemIdx) => {
          const p = item.isQuickOrder ? item.price : (item.product?.promotionalPrice ?? item.product?.price);
          return sum + (p || 0) * getItemQty(selectedInquiry.id, itemIdx, item.quantity || 1);
        }, 0);

        return (
          <div className={`fixed inset-0 z-site-overlay flex justify-center overflow-y-auto px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))] ${uiSurfaces.modalBackdrop}`}>
            <div className={`mx-4 w-full max-w-sm rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal} p-6`}>
              <h3 className={`mb-2 text-lg font-bold ${uiSurfaces.titleText}`}>确认提交订单</h3>
              <p className={`mb-4 text-sm ${uiSurfaces.textSecondary}`}>
                确认后将生成正式订单，已选 {selIndices.length} 种产品将转为独立订单，信息及价格不可再更改。
              </p>
              <div className="mb-4 rounded-[var(--brand-border-radius)] bg-[var(--brand-color-primary-bg)] p-3">
                <p className={`text-sm ${uiSurfaces.textInteractive}`}>
                  订单金额：<span className="font-bold">{formatPrice(selTotal)}</span>
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
                    await submitOrder(selectedInquiry.id, selIndices);
                  }}
                  disabled={submitting}
                  className={`${uiSurfaces.buttonPrimary} flex-1 text-sm`}
                >
                  {submitting ? '提交中...' : '确认提交'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


// Last modified: Thu Jun  4 11:37:29 CST 202 
