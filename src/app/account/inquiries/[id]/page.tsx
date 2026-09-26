'use client';

import { use } from 'react';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, FileText, Clock, Check,
  Building2, MapPin, MessageSquare
} from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

function translatePaymentMethod(method: string): string {
  const map: Record<string, string> = {
    'rjmart': '锐竞',
    'ruijing': '锐竞',
    'weixin': '微信支付',
    'zfb': '支付宝',
    'card': '银行卡',
    'corporate': '企业转账',
  };
  return map[method.toLowerCase()] || method;
}

type InquiryItem = {
  isQuickOrder?: boolean;
  name?: string;
  brand?: string;
  catalogNumber?: string;
  quantity?: number;
  price?: number;
  leadTime?: string;
  customerLeadTime?: string | null;
  actualLeadTime?: string | null;
  available?: boolean;
  product?: {
    name?: string;
    brand?: string;
    catalogNumber?: string;
    promotionalPrice?: number;
    price?: number;
  };
};

type Inquiry = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  institution: string;
  department?: string;
  address?: string;
  notes?: string;
  items: InquiryItem[];
  subtotal: number;
  status: string;
  paymentMethod?: string;
  leadTime?: string;
  identity?: string;
  advisorName?: string;
  advisorPhone?: string;
  createdAt: string;
  activeQuote?: { status: string; sentAt?: string; acceptedAt?: string; items: InquiryItem[] } | null;
  operationLogs?: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  'pending_quote': { label: '待报价', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/20', icon: Clock },
  'quote_sent': { label: '已报价', color: 'text-brand-700 dark:text-brand-300', bg: 'bg-brand-50 dark:bg-brand-500/20', icon: FileText },
  'closed': { label: '已关闭', color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-500/20', icon: Check },
};

const formatPrice = (price: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);


interface LogEntry {
  adminId: string;
  adminEmail: string;
  time: string;
  items: { name?: string; quantity?: number; price?: number; leadTime?: string }[];
}

function parseLogs(json: string): LogEntry[] {
  try { return JSON.parse(json); } catch { return []; }
}

export default function InquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
const { data: session, status } = useSession();
  const router = useRouter();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [loading, setLoading] = useState(true);
  const [parsedItems, setParsedItems] = useState<InquiryItem[]>([]);
  const [parsedLogs, setParsedLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/account/inquiries');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !id) return;
    fetch(`/api/inquiries/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          router.replace('/account/inquiries');
          return;
        }
        setInquiry(data);
        setParsedItems(data.activeQuote?.items ?? data.items);
        setParsedLogs(parseLogs(data.operationLogs || '[]'));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status, id, router]);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!inquiry) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">询价单不存在</div>
      </div>
    );
  }

  const s = STATUS_CONFIG[inquiry.status] || STATUS_CONFIG['pending_quote'];

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/account/inquiries" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50">
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">询价单详情</h1>
            <p className="text-xs font-mono text-gray-400">{inquiry.id}</p>
          </div>
          <span className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${s.bg} ${s.color}`}>
            <s.icon size={14} />
            {s.label}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: Contact Info */}
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-5">
              <h2 className="font-semibold text-gray-800 dark:text-slate-900 mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-brand-600 dark:text-brand-500" /> 询价信息
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                  <span className="text-gray-500 dark:text-gray-400">询价人</span>
                  <span className="text-gray-800 dark:text-slate-900 font-medium text-right">{inquiry.name}</span>
                </div>
                <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                  <span className="text-gray-500 dark:text-gray-400">邮箱</span>
                  <span className="text-gray-800 dark:text-slate-900 text-right">{inquiry.email}</span>
                </div>
                {inquiry.phone && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">电话</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right">{inquiry.phone}</span>
                  </div>
                )}
                <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                  <span className="text-gray-500 dark:text-gray-400">单位</span>
                  <span className="text-gray-800 dark:text-slate-900 text-right">{inquiry.institution}</span>
                </div>
                {inquiry.department && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">部门</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right">{inquiry.department}</span>
                  </div>
                )}
                {inquiry.address && (
                  <div className="flex items-start gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-slate-400">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs block">通讯地址</span>
                      <p className="text-gray-800 dark:text-slate-900 font-medium">{inquiry.address}</p>
                    </div>
                  </div>
                )}
                {inquiry.notes && (
                  <div className="flex items-start gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-slate-400">
                    <MessageSquare className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs block">备注</span>
                      <p className="text-gray-800 dark:text-slate-900 font-medium">{inquiry.notes}</p>
                    </div>
                  </div>
                )}
                {inquiry.identity && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">身份</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right">{inquiry.identity}</span>
                  </div>
                )}
                {inquiry.advisorName && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">顾问</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right">{inquiry.advisorName}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-5">
              <h2 className="font-semibold text-gray-800 dark:text-slate-900 mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-600 dark:text-brand-500" /> 询价单信息
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                  <span className="text-gray-500 dark:text-gray-400">提交时间</span>
                  <span className="text-gray-800 dark:text-slate-900 text-right">{new Date(inquiry.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                {inquiry.activeQuote && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">报价发送</span>
                    <span className="text-brand-600 dark:text-brand-500 text-right font-medium">
                      {inquiry.activeQuote.sentAt ? new Date(inquiry.activeQuote.sentAt).toLocaleString('zh-CN') : '是'}
                    </span>
                  </div>
                )}
                {inquiry.activeQuote?.status === 'accepted' && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">报价确认</span>
                    <span className="text-brand-600 dark:text-brand-500 text-right font-medium">已确认</span>
                  </div>
                )}
                {inquiry.leadTime && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">货期</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right">{inquiry.leadTime}</span>
                  </div>
                )}
                {inquiry.paymentMethod && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-400">付款方式</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right font-medium">{translatePaymentMethod(inquiry.paymentMethod)}</span>
                  </div>
                )}
              </div>

              {inquiry.notes && (
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-400">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">备注</p>
                  <p className="text-sm text-gray-700 dark:text-gray-600">{inquiry.notes}</p>
                </div>
              )}
            </div>

            {/* Operation Logs */}
            {parsedLogs.length > 0 && (
              <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-5">
                <h2 className="font-semibold text-gray-800 dark:text-slate-900 mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-brand-600 dark:text-brand-500" /> 操作记录
                </h2>
                <div className="space-y-4">
                  {parsedLogs.map((log, i) => (
                    <div key={i} className="text-sm">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-medium text-gray-800 dark:text-slate-900">{log.adminEmail}</span>
                        <span className="text-xs text-gray-400">{new Date(log.time).toLocaleString('zh-CN')}</span>
                      </div>
                      <div className="pl-3 border-l-2 border-gray-100 dark:border-slate-400 space-y-1">
                        {log.items?.map((item: { name?: string; quantity?: number; price?: number; leadTime?: string }, j: number) => (
                          <div key={j} className="text-xs text-gray-600 dark:text-gray-500">
                            {item.name} × {item.quantity} @ {formatPrice(item.price ?? 0)} {item.leadTime && `| 货期: ${item.leadTime}`}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Item List */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-400 bg-gray-50/50 dark:bg-gray-700/30">
                <h2 className="font-semibold text-gray-800 dark:text-slate-900">询价产品明细</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="border-b border-gray-100 bg-brand-50/40 text-gray-500 dark:border-slate-400 dark:bg-slate-200/40 dark:text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-medium">产品</th>
                      <th className="px-4 py-3 font-medium text-center">品牌</th>
                      <th className="px-4 py-3 font-medium text-center">Catalog No.</th>
                      <th className="px-4 py-3 font-medium text-center">数量</th>
                      <th className="px-4 py-3 font-medium text-center">单价</th>
                      <th className="px-4 py-3 font-medium text-center">期望 / 实际货期</th>
                      <th className="px-4 py-3 font-medium text-right">小计</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-200/50">
                    {parsedItems.map((item, i) => {
                      const name = item.name || item.product?.name || '未知产品';
                      const brand = item.brand || item.product?.brand || '-';
                      const catalogNumber = item.catalogNumber || item.product?.catalogNumber || '-';
                      const qty = item.quantity || 1;
                      const price = item.price || item.product?.price || item.product?.promotionalPrice || 0;

                      return (
                        <tr key={i} className="hover:bg-gray-50/30 dark:hover:bg-gray-700/20">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-800 dark:text-slate-900">{name}</div>
                            {item.isQuickOrder && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-orange-100 dark:bg-orange-500/30 text-orange-600 dark:text-orange-500 mt-0.5">快捷订单</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-500 text-xs">{brand}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-gray-500 dark:text-gray-400">{catalogNumber}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-6 bg-gray-100 dark:bg-gray-700/50 rounded text-gray-700 dark:text-gray-300 font-medium text-xs">× {qty}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {price > 0 ? (
                              <span className="text-brand-600 dark:text-brand-500 font-medium">{formatPrice(price)}</span>
                            ) : (
                              <span className="text-xs text-gray-400 dark:text-gray-500">待报价</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-xs">
                            <span className="text-gray-500 dark:text-gray-400">
                              {item.customerLeadTime ? `${item.customerLeadTime}天` : '不限'}
                            </span>
                            {item.actualLeadTime ? (
                              <div className="mt-0.5">
                                <span className="text-brand-600 dark:text-brand-500 font-medium">{item.actualLeadTime}天</span>
                                <span className="text-xs text-amber-600 dark:text-amber-500 ml-1">(24h有效)</span>
                              </div>
                            ) : (
                              <div className="mt-0.5 text-gray-400 dark:text-gray-500">实时: -</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-slate-900">
                            {price > 0 ? formatPrice(price * qty) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-gray-100 bg-brand-50/30 px-5 py-4 dark:border-slate-400 dark:bg-slate-200/30">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400">询价单合计</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 dark:text-gray-500">({parsedItems.length} 项)</span>
                    <span className="text-xl font-bold text-brand-600 dark:text-brand-500">{formatPrice(inquiry.subtotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
