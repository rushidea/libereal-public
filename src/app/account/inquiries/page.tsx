'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Package, FileText, Check, Clock, ExternalLink } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

import Breadcrumb from '@/components/Breadcrumb';
import { ORDER_STATUS_LABELS } from '@/lib/order-domain';

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

interface Order {
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
  organizationId?: string | null;
  ownerScope?: 'personal' | 'organization';
  activeQuote?: { status: string; sentAt?: string; acceptedAt?: string; items: InquiryItem[] } | null;
  orderCount?: number;
  orders?: Order[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  'pending_quote': { label: '待报价', color: 'bg-amber-100 text-amber-700', icon: Clock },
  'quote_sent': { label: '已报价', color: 'bg-brand-100 text-brand-700', icon: FileText },
  'closed': { label: '待报价', color: 'bg-amber-100 text-amber-700', icon: Clock },
};

export default function MyInquiriesPage() {
  const { data: session, status } = useSession();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<number>>>({});
  const [editedQuantities, setEditedQuantities] = useState<Record<string, Record<number, number>>>({});
  const [inquiryOrders, setInquiryOrders] = useState<Record<string, Order[]>>({});

  useEffect(() => {
    if (status === 'authenticated') {
      fetchInquiries();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function fetchInquiries() {
    setLoading(true);
    try {
      const res = await fetch('/api/my-orders');
      const data = await res.json();
      const freshInquiries: Inquiry[] = data.inquiries || [];
      setInquiries(freshInquiries);

      // Fetch orders for each inquiry that has associated orders
      const ordersMap: Record<string, Order[]> = {};
      const inqsWithOrders = freshInquiries.filter((inq: Inquiry) => (inq.orderCount || 0) > 0);
      await Promise.all(inqsWithOrders.map(async (inq: Inquiry) => {
        try {
          const r = await fetch(`/api/orders/${inq.id}/confirm-items`);
          if (r.ok) {
            const d = await r.json();
            ordersMap[inq.id] = d.orders || [];
          }
        } catch {}
      }));
      setInquiryOrders(ordersMap);

      if (selectedInquiry) {
        const updated = freshInquiries.find((o: Inquiry) => o.id === selectedInquiry.id);
        if (updated) setSelectedInquiry(updated);
        else setSelectedInquiry(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function formatPrice(price: number) {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
  }

  function parseItems(items: InquiryItem[]): InquiryItem[] { return items; }

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
      .map((item, idx) => (!item.ordered && item.price != null) ? idx : -1)
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

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm p-8 text-center">
          <p className="text-gray-600 dark:text-slate-900 mb-4">请先登录查看您的询价记录</p>
          <Link href="/login" className="text-brand-600 hover:text-brand-700">前往登录</Link>
        </div>
      </div>
    );
  }

  const quoteSentCount = inquiries.filter(i => i.activeQuote?.status === 'sent').length;

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 pb-8">
        <Breadcrumb items={[
          { label: '首页', href: '/' },
          { label: '我的账户', href: '/account' },
          { label: '我的询价' }
        ]} />

        <div className="mb-4 bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileText className="text-brand-600" size={22} />
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">我的询价</h1>
                <p className="text-xs text-gray-400 mt-0.5">管理您的询价记录</p>
              </div>
            </div>
            {quoteSentCount > 0 && (
              <span className="text-xs bg-amber-100 dark:bg-amber-500/30 text-amber-700 dark:text-amber-600 px-3 py-1 rounded-full">
                {quoteSentCount} 条新报价待确认
              </span>
            )}
          </div>
        </div>

        {inquiries.length === 0 ? (
          <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm p-12 text-center">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无询价记录</p>
            <Link href="/" className="text-brand-600 hover:text-brand-700 text-sm mt-2 inline-block">
              去逛逛 →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {inquiries.map((inquiry) => {
              const items = parseItems(inquiry.activeQuote?.items ?? inquiry.items);
              const statusCfg = STATUS_CONFIG[inquiry.status] || STATUS_CONFIG['pending_quote'];
              const linkedOrders = inquiryOrders[inquiry.id] || [];

              return (
                <div
                  key={inquiry.id}
                  className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 overflow-hidden hover:shadow-md transition-shadow"
                >
                  {/* Header */}
                  <div
                    className="p-6 cursor-pointer"
                    onClick={() => setSelectedInquiry(selectedInquiry?.id === inquiry.id ? null : inquiry)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-800 dark:text-slate-900">{inquiry.id.slice(0, 16)}...</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                            {statusCfg.label}
                          </span>
                          {inquiry.ownerScope === 'organization' && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">组织采购</span>}
                          {linkedOrders.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-500/30 text-blue-700 dark:text-blue-600">
                              <ExternalLink className="w-3 h-3" />
                              {linkedOrders.length} 张订单
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{new Date(inquiry.createdAt).toLocaleDateString('zh-CN')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-brand-600 dark:text-brand-500">{formatPrice(inquiry.subtotal)}</p>
                        <p className="text-xs text-gray-400">{items.length} 种产品</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-500">{inquiry.institution}</p>
                  </div>

                  {/* Expanded Details */}
                  {selectedInquiry?.id === inquiry.id && (
                    <div className="border-t border-gray-100 dark:border-slate-400 bg-gray-50/50 dark:bg-gray-700/30 p-6">
                      {/* Quote received banner */}
                      {inquiry.activeQuote?.status === 'sent' && (
                        <div className="mb-4 p-4 bg-brand-50 dark:bg-brand-500/20 border border-brand-200 dark:border-brand-500/40 rounded-xl">
                          <div className="flex items-center gap-2 text-brand-700 dark:text-brand-500 mb-2">
                            <FileText className="w-5 h-5" />
                            <p className="font-medium">您的询价已收到报价</p>
                          </div>
                          <p className="text-sm text-brand-600/80 dark:text-brand-400/70">
                            报价时间：{inquiry.activeQuote.sentAt ? new Date(inquiry.activeQuote.sentAt).toLocaleString('zh-CN') : '-'}
                          </p>
                        </div>
                      )}

                      {/* Linked Orders */}
                      {linkedOrders.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-600 mb-2">已生成的订单</p>
                          <div className="space-y-2">
                            {linkedOrders.map(order => (
                              <Link
                                key={order.id}
                                href="/account/orders"
                                className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-500/20 border border-blue-200 dark:border-blue-500/40 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-500/30 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <Package className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                                  <span className="text-sm font-mono text-blue-700 dark:text-blue-600">{order.id}</span>
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
 order.status === 'pending' ? 'bg-amber-100 dark:bg-amber-500/30 text-amber-700 dark:text-amber-600' :
 order.status === 'confirmed' ? 'bg-blue-100 dark:bg-blue-500/30 text-blue-700 dark:text-blue-600' :
 order.status === 'shipped' ? 'bg-purple-100 dark:bg-purple-500/30 text-purple-700 dark:text-purple-600' :
 'bg-brand-100 dark:bg-brand-500/30 text-brand-700 dark:text-brand-600'
 }`}>
                                    {(ORDER_STATUS_LABELS as Record<string, string>)[order.status] || order.status}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-bold text-blue-700 dark:text-blue-600">{formatPrice(order.subtotal)}</span>
                                  <ExternalLink className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Product selection controls */}
                      {inquiry.activeQuote?.status === 'sent' && (
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-600">
                            选择产品生成订单（已选 {selectedItems[inquiry.id]?.size || 0} 种）
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); selectAll(inquiry.id, items); }}
                              className="text-xs text-blue-600 dark:text-blue-500 hover:text-blue-700 dark:hover:text-blue-600 underline"
                            >
                              全选
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); clearSelection(inquiry.id); }}
                              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-600 underline"
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
                          // 1. 平铺结构（来自 /api/inquiry 创建的询价单）
                          // 2. 嵌套结构（来自产品列表/快速下单）
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
                              className={`bg-white dark:bg-slate-200/75 rounded-xl border transition-colors ${
 canSelect ? 'cursor-pointer' : ''
 } ${
 isOrdered ? 'border-gray-200 dark:border-slate-400 bg-gray-50/50 dark:bg-slate-700/50 opacity-70' :
 isSelected ? 'border-brand-300 dark:border-brand-500 bg-brand-50/50 dark:bg-brand-500/20' : 'border-gray-100 dark:border-slate-400'
 }`}
                              onClick={() => canSelect ? toggleItem(inquiry.id, i) : undefined}
                            >
                              {/* 顶部：复选框 + 产品名 + 状态徽章 */}
                              <div className="p-4 flex items-center gap-3">
                                {canSelect && (
                                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
 isSelected ? 'bg-brand-500 dark:bg-brand-600 border-brand-500 dark:border-brand-600' : 'border-gray-300 dark:border-slate-400'
 }`}>
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                )}

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-medium text-gray-900 dark:text-slate-900 truncate">{name || '未知产品'}</p>
                                    {isOrdered && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 dark:bg-gray-600/50 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        已转订单
                                      </span>
                                    )}
                                    {needsQuote && !isOrdered && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-500/30 text-amber-700 dark:text-amber-500 whitespace-nowrap">
                                        待报价
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 truncate">{brand} · {catNum}</p>
                                </div>

                                <div className="text-right flex-shrink-0">
                                  {needsQuote ? (
                                    <p className="text-sm font-semibold text-amber-600 dark:text-amber-500">待报价</p>
                                  ) : (
                                    <p className="text-sm font-semibold text-gray-800 dark:text-slate-900">{formatPrice(subtotal)}</p>
                                  )}
                                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">×{finalQty}</p>
                                </div>
                              </div>

                              {/* 底部：单价 / 数量 / 货期 三栏 */}
                              <div className="grid grid-cols-3 gap-3 px-4 pb-4 text-sm border-t border-gray-100 dark:border-slate-400 pt-3">
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">单价</p>
                                  <p className={`font-medium ${needsQuote ? 'text-amber-600 dark:text-amber-500' : 'text-brand-600 dark:text-brand-500'}`}>
                                    {needsQuote ? '待报价' : formatPrice(price)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">数量</p>
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
                                      className="w-16 px-2 py-1 border border-gray-200 dark:border-slate-400 rounded-lg text-sm font-medium text-gray-700 dark:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-400"
                                    />
                                  ) : (
                                    <p className="font-medium text-gray-700 dark:text-slate-900">{finalQty}</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">货期</p>
                                  <p className="font-medium text-gray-700 dark:text-slate-900 text-xs">{leadTime || '-'}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Bottom: Submit selected items as order */}
                      {inquiry.activeQuote?.status === 'sent' && (
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-400">
                          {(() => {
                            const selId = selectedItems[inquiry.id];
                            const selCount = selId?.size || 0;
                            const selTotal = selCount > 0 ? items
                              .filter((_, idx) => selId?.has(idx))
                              .reduce((sum, item, itemIdx) => {
                                const p = item.isQuickOrder ? item.price : (item.product?.promotionalPrice ?? item.product?.price);
                                return sum + (p || 0) * getItemQty(inquiry.id, itemIdx, item.quantity || 1);
                              }, 0) : 0;

                            return (
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <p className="font-medium text-gray-700 dark:text-gray-600">已选产品小计</p>
                                  <p className="text-xl font-bold text-brand-600 dark:text-brand-500">{formatPrice(selTotal)}</p>
                                  {selCount > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">已选 {selCount} 种产品</p>}
                                </div>
                                <div className="flex items-center gap-3">
                                  {selCount > 0 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); clearSelection(inquiry.id); }}
                                      className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-600 underline"
                                    >
                                      清除选择
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setShowConfirmModal(true); }}
                                    disabled={selCount === 0}
                                    className="bg-brand-500 hover:bg-brand-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium px-6 py-2.5 rounded-xl transition-colors"
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
      </main>

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
          <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
            <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-900 mb-2">确认提交订单</h3>
              <p className="text-sm text-gray-600 dark:text-gray-500 mb-4">
                确认后将生成正式订单，已选 {selIndices.length} 种产品将转为独立订单，信息及价格不可再更改。
              </p>
              <div className="bg-brand-50 dark:bg-brand-500/20 rounded-xl p-3 mb-4">
                <p className="text-sm text-brand-700 dark:text-brand-600">
                  订单金额：<span className="font-bold">{formatPrice(selTotal)}</span>
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-slate-400 text-gray-600 dark:text-gray-600 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-400/20 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    await submitOrder(selectedInquiry.id, selIndices);
                  }}
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white text-sm font-medium transition-colors"
                >
                  {submitting ? '提交中...' : '确认提交'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
