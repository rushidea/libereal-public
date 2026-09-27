'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import {
  Search, Package, Archive, Trash2,  Check, Clock, XCircle, ChevronRight, MessageSquare,
} from 'lucide-react';

interface Inquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  institution: string;
  department?: string;
  address?: string;
  items: InquiryItem[];
  subtotal: number;
  hasUnresolvedPricing?: boolean;
  status: string;
  createdAt: string;
  paymentMethod?: string;
  notes?: string;
  userId?: string;
  activeQuote?: { status: string; sentAt?: string; acceptedAt?: string; version: number; items: InquiryItem[] } | null;
  quoteVersions?: QuoteVersion[];
  operationLogs?: string;
}

interface QuoteVersion {
  id: string;
  version: number;
  status: string;
  subtotal: number;
  currency: string;
  validUntil?: string | null;
  sentAt?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  items: InquiryItem[];
}

interface InquiryItem {
  id?: string;
  name?: string;
  brand?: string;
  catalogNumber?: string;
  variantId?: string | null;
  spec?: string | null;
  unit?: string | null;
  quantity?: number;
  price?: number;
  leadTime?: string;
  customerLeadTime?: string | null;
  actualLeadTime?: string | null;
  product?: { name?: string; brand?: string; catalogNumber?: string; promotionalPrice?: number; price?: number };
}

export default function AdminInquiriesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-brand-600" /> 活跃询价
        </h1>
        <p className="text-sm text-gray-500 mt-1">查看和处理所有进行中的询价单（待处理/已报价/已接受）</p>
      </div>
      <InquiriesPanel />
    </div>
  );
}

function InquiriesPanel() {
  const router = useRouter();
  const { data: session } = useSession();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [inquiryDateFrom, setInquiryDateFrom] = useState('');
  const [inquiryDateTo, setInquiryDateTo] = useState('');
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [inquiryItems, setInquiryItems] = useState<InquiryItem[]>([]);
  const [inquiryLogsExpanded, setInquiryLogsExpanded] = useState(false);
  const [selectedInquiries, setSelectedInquiries] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inquiries');
      const data = await res.json();
      setInquiries(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (selectedInquiry) {
      setInquiryItems(selectedInquiry.items);
    } else {
      setInquiryItems([]);
    }
    setInquiryLogsExpanded(false);
  }, [selectedInquiry]);

  const inquiryTotal = inquiryItems.reduce((sum, item) => {
    const price = item.price || 0;
    const qty = item.quantity || 1;
    return sum + price * qty;
  }, 0);

  async function archiveInquiries(inquiryIds: string[]) {
    if (!confirm(`确定要归档 ${inquiryIds.length} 个询价单吗？`)) return;
    try {
      const res = await fetch('/api/admin/inquiries/archive', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inquiryIds, action: 'archive' }),
      });
      if (res.ok) {
        fetchData();
        setSelectedInquiry(null);
      }
    } catch (e) { console.error(e); }
  }

  async function deleteInquiries(inquiryIds: string[]) {
    if (!confirm(`确定要删除 ${inquiryIds.length} 个询价单吗？此操作不可恢复！`)) return;
    try {
      const res = await fetch('/api/admin/inquiries/archive', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inquiryIds, action: 'delete' }),
      });
      if (res.ok) {
        fetchData();
        setSelectedInquiry(null);
        setSelectedInquiries(new Set());
      }
    } catch (e) { console.error(e); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="text" placeholder="搜索询价单..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-64 text-gray-900" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">从</span>
          <input type="date" value={inquiryDateFrom} onChange={e => setInquiryDateFrom(e.target.value)}
            className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-900" />
          <span className="text-sm text-gray-500">至</span>
          <input type="date" value={inquiryDateTo} onChange={e => setInquiryDateTo(e.target.value)}
            className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-900" />
          {(inquiryDateFrom || inquiryDateTo) && (
            <button onClick={() => { setInquiryDateFrom(''); setInquiryDateTo(''); }}
              className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">清除</button>
          )}
        </div>
        <button onClick={() => router.push('/admin/inquiries/archived')}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium flex items-center gap-1.5">
          <Package className="w-4 h-4" /> 已归档
        </button>
        {selectedInquiries.size > 0 && (
          <>
            <button onClick={() => archiveInquiries(Array.from(selectedInquiries))}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
              <Archive className="w-4 h-4" /> 批量归档 ({selectedInquiries.size})
            </button>
            <button onClick={() => deleteInquiries(Array.from(selectedInquiries))}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> 批量删除 ({selectedInquiries.size})
            </button>
          </>
        )}
      </div>

      <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">
                  <input type="checkbox"
                    checked={selectedInquiries.size === inquiries.length && inquiries.length > 0}
                    onChange={e => { setSelectedInquiries(e.target.checked ? new Set(inquiries.map(i => i.id)) : new Set()); }}
                    className="w-4 h-4 text-brand-600 rounded border-gray-300" />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">编号</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">客户</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">机构</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">金额</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">状态</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">时间</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filtered = inquiries.filter(i => {
                  const matchSearch = !search || i.name.includes(search) || i.email.includes(search) || (i.institution && i.institution.includes(search)) || i.id.includes(search);
                  const inquiryDate = new Date(i.createdAt);
                  const matchDateFrom = !inquiryDateFrom || inquiryDate >= new Date(inquiryDateFrom);
                  const matchDateTo = !inquiryDateTo || inquiryDate <= new Date(inquiryDateTo + 'T23:59:59');
                  return matchSearch && matchDateFrom && matchDateTo;
                });
                if (filtered.length === 0) {
                  return <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-600">暂无询价单</td></tr>;
                }
                return filtered.map(inquiry => (
                  <InquiryRow
                    key={inquiry.id}
                    inquiry={inquiry}
                    selectedInquiry={selectedInquiry}
                    setSelectedInquiry={setSelectedInquiry}
                    selectedInquiries={selectedInquiries}
                    setSelectedInquiries={setSelectedInquiries}
                    inquiryItems={inquiryItems}
                    setInquiryItems={setInquiryItems}
                    inquiryLogsExpanded={inquiryLogsExpanded}
                    setInquiryLogsExpanded={setInquiryLogsExpanded}
                    session={session}
                    inquiryTotal={inquiryTotal}
                    fetchData={fetchData}
                    archiveInquiries={archiveInquiries}
                    deleteInquiries={deleteInquiries}
                  />
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InquiryRow({
  inquiry, selectedInquiry, setSelectedInquiry, selectedInquiries, setSelectedInquiries,
  inquiryItems, setInquiryItems, inquiryLogsExpanded, setInquiryLogsExpanded,
  session, inquiryTotal, fetchData, archiveInquiries, deleteInquiries,
}: {
  inquiry: Inquiry;
  selectedInquiry: Inquiry | null;
  setSelectedInquiry: (i: Inquiry | null) => void;
  selectedInquiries: Set<string>;
  setSelectedInquiries: (s: Set<string>) => void;
  inquiryItems: InquiryItem[];
  setInquiryItems: (i: InquiryItem[]) => void;
  inquiryLogsExpanded: boolean;
  setInquiryLogsExpanded: (b: boolean) => void;
  session: Session | null;
  inquiryTotal: number;
  fetchData: () => Promise<void>;
  archiveInquiries: (ids: string[]) => Promise<void>;
  deleteInquiries: (ids: string[]) => Promise<void>;
}) {
  const isExpanded = selectedInquiry?.id === inquiry.id;

  return (
    <>
      <tr className={`border-b border-gray-100 cursor-pointer ${isExpanded ? 'bg-brand-50/50' : 'hover:bg-gray-50/50'}`}
        onClick={() => setSelectedInquiry(isExpanded ? null : inquiry)}>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={selectedInquiries.has(inquiry.id)}
            onChange={e => {
              const newSelected = new Set(selectedInquiries);
              if (e.target.checked) newSelected.add(inquiry.id);
              else newSelected.delete(inquiry.id);
              setSelectedInquiries(newSelected);
            }}
            className="w-4 h-4 text-brand-600 rounded border-gray-300" />
        </td>
        <td className="px-4 py-3 font-mono text-xs text-gray-600 break-all">{inquiry.id}</td>
        <td className="px-4 py-3">
          <div className="font-medium text-gray-900">{inquiry.name}（{inquiry.email}）</div>
        </td>
        <td className="px-4 py-3 text-gray-700">{inquiry.institution}</td>
        <td className="px-4 py-3 font-semibold text-gray-900">{inquiry.hasUnresolvedPricing ? '待报价确认' : `¥${inquiry.subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}</td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            inquiry.status === 'closed' ? 'bg-gray-100 text-gray-600' :
            inquiry.status === 'pending_quote' ? 'bg-yellow-100 text-yellow-700' :
            inquiry.status === 'quote_sent' ? 'bg-blue-100 text-blue-700' :
            'bg-green-100 text-green-700'
          }`}>
            {inquiry.status === 'closed' ? <XCircle className="w-3 h-3" /> :
             inquiry.status === 'pending_quote' ? <Clock className="w-3 h-3" /> :
             <Check className="w-3 h-3" />}
            {inquiry.status === 'closed' ? '已关闭' :
             inquiry.status === 'pending_quote' ? '待报价' :
             inquiry.status === 'quote_sent' ? '已发报价' : inquiry.status}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-600 text-xs">{new Date(inquiry.createdAt).toLocaleDateString('zh-CN')}</td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <button onClick={() => archiveInquiries([inquiry.id])}
              className="text-purple-600 hover:text-purple-700 text-xs flex items-center gap-1" title="归档">
              <Archive className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => deleteInquiries([inquiry.id])}
              className="text-red-600 hover:text-red-700 text-xs flex items-center gap-1" title="删除">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="bg-brand-50/70 p-4 border-b border-brand-200">
            <InquiryDetailPanel
              inquiry={inquiry}
              inquiryItems={inquiryItems}
              setInquiryItems={setInquiryItems}
              inquiryLogsExpanded={inquiryLogsExpanded}
              setInquiryLogsExpanded={setInquiryLogsExpanded}
              session={session}
              inquiryTotal={inquiryTotal}
              fetchData={fetchData}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function InquiryDetailPanel({
  inquiry, inquiryItems, setInquiryItems, inquiryLogsExpanded, setInquiryLogsExpanded,
  session, inquiryTotal, fetchData,
}: {
  inquiry: Inquiry;
  inquiryItems: InquiryItem[];
  setInquiryItems: (i: InquiryItem[]) => void;
  inquiryLogsExpanded: boolean;
  setInquiryLogsExpanded: (b: boolean) => void;
  session: Session | null;
  inquiryTotal: number;
  fetchData: () => Promise<void>;
}) {
  return (
    <div className="bg-white rounded-lg border border-brand-300 shadow-sm p-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><p className="text-xs text-gray-600 mb-1">客户姓名</p><p className="font-medium text-gray-800">{inquiry.name}</p></div>
        <div><p className="text-xs text-gray-600 mb-1">邮箱</p><p className="text-sm text-gray-700">{inquiry.email}</p></div>
        <div><p className="text-xs text-gray-600 mb-1">电话</p><p className="text-sm text-gray-700">{inquiry.phone}</p></div>
        <div><p className="text-xs text-gray-600 mb-1">机构</p><p className="text-sm text-gray-700">{inquiry.institution}</p></div>
        {inquiry.department && (
          <div><p className="text-xs text-gray-600 mb-1">部门</p><p className="text-sm text-gray-700">{inquiry.department}</p></div>
        )}
        {inquiry.paymentMethod !== undefined && (
          <div>
            <p className="text-xs text-gray-600 mb-1">付款方式</p>
            <select value={inquiry.paymentMethod || ''}
              onChange={async e => {
                const newMethod = e.target.value;
                const res = await fetch(`/api/inquiries/${inquiry.id}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ paymentMethod: newMethod }),
                });
                if (res.ok) fetchData();
              }}
              className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900">
              <option value="">未选择</option>
              <option value="对公转账">对公转账</option>
              <option value="锐竞平台">锐竞平台</option>
              <option value="喀斯玛平台">喀斯玛平台</option>
            </select>
          </div>
        )}
        <div className="col-span-2">
          <label className="text-xs text-gray-600 mb-1 block">通讯地址</label>
          <input type="text" value={inquiry.address || ''}
            onChange={async e => {
              const newAddress = e.target.value;
              const res = await fetch(`/api/inquiries/${inquiry.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: newAddress }),
              });
              if (res.ok) fetchData();
            }}
            className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-600 mb-1 block">备注</label>
          <textarea value={inquiry.notes || ''}
            onChange={async e => {
              const newNotes = e.target.value;
              const res = await fetch(`/api/inquiries/${inquiry.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: newNotes }),
              });
              if (res.ok) fetchData();
            }}
            rows={2}
            className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900" />
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-600 mb-2">询价产品（可直接编辑价格和货期）</p>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {inquiryItems.map((item, i) => {
            const name = item.name || item.product?.name || '未知产品';
            const brand = item.brand || item.product?.brand || '';
            const catalogNumber = item.catalogNumber || item.product?.catalogNumber || '';
            const qty = item.quantity || 1;
            return (
              <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-0">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 bg-blue-50 text-blue-600">
                    <Package className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                    <p className="text-xs text-gray-600">{brand} · {catalogNumber}</p>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">单价</label>
                    <input type="number" step="0.01" value={item.price || ''}
                      onChange={e => {
                        const updated = [...inquiryItems];
                        updated[i] = { ...updated[i], price: parseFloat(e.target.value) || 0 };
                        setInquiryItems(updated);
                      }}
                      className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">数量</label>
                    <p className="text-sm px-2 py-1 text-gray-700">{qty}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">客户期望</label>
                    <p className="text-sm px-2 py-1 text-gray-700">
                      {item.customerLeadTime || '不限'}
                    </p>
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs text-gray-600 mb-1 block">实际货期</label>
                    <input type="text" value={item.actualLeadTime || item.leadTime || ''}
                      onChange={e => {
                        const updated = [...inquiryItems];
                        updated[i] = { ...updated[i], actualLeadTime: e.target.value, leadTime: e.target.value };
                        setInquiryItems(updated);
                      }}
                      placeholder="如：28天"
                      className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between items-center pt-4 border-t border-gray-200">
        <span className="text-gray-700 font-medium">询价总计</span>
        <span className="text-xl font-bold text-brand-600">¥{inquiryTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="pt-4 border-t border-gray-200">
        <button onClick={async () => {
          if (!confirm('确定提交报价单给客户吗？')) return;
          const patchRes = await fetch(`/api/inquiries/${inquiry.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: inquiryItems,
              adminLog: {
                adminId: session?.user?.id || session?.user?.email || 'admin',
                adminEmail: session?.user?.email,
                time: new Date().toISOString(),
                items: inquiryItems.map(it => ({ name: it.name, price: it.price, quantity: it.quantity, leadTime: it.leadTime || '' })),
              },
            }),
          });
          if (!patchRes.ok) {
            const err = await patchRes.json();
            alert('保存失败：' + (err.error || '未知错误'));
            return;
          }
          fetchData();
          alert('报价已记录，可继续修改');
        }} className="w-full py-3 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700">
          提交报价
        </button>
      </div>
      {(inquiry.quoteVersions?.length || 0) > 0 && (
        <div className="border-t border-gray-200 pt-4">
          <p className="mb-2 text-xs font-medium text-gray-600">报价版本</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-[620px] w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2">版本</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">金额</th><th className="px-3 py-2">发出时间</th><th className="px-3 py-2">有效期</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {inquiry.quoteVersions?.map((quote) => <tr key={quote.id}><td className="px-3 py-2 font-medium text-gray-900">第 {quote.version} 版</td><td className="px-3 py-2 text-gray-600">{{ draft: '草稿', sent: '已发送', accepted: '已接受', superseded: '已替代', expired: '已过期' }[quote.status] || quote.status}</td><td className="px-3 py-2 font-medium text-gray-900">¥{quote.subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td><td className="px-3 py-2 text-gray-600">{quote.sentAt ? new Date(quote.sentAt).toLocaleString('zh-CN') : '—'}</td><td className="px-3 py-2 text-gray-600">{quote.validUntil ? new Date(quote.validUntil).toLocaleString('zh-CN') : '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <InquiryOperationLogs
        operationLogs={inquiry.operationLogs}
        expanded={inquiryLogsExpanded}
        onToggle={() => setInquiryLogsExpanded(!inquiryLogsExpanded)}
      />
      {inquiry.notes && <div><p className="text-xs text-gray-600 mb-1">备注</p><p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{inquiry.notes}</p></div>}
      <div><p className="text-xs text-gray-600 mb-1">提交时间</p><p className="text-sm text-gray-700">{new Date(inquiry.createdAt).toLocaleString('zh-CN')}</p></div>
    </div>
  );
}

function InquiryOperationLogs({ operationLogs, expanded, onToggle }: { operationLogs?: string; expanded: boolean; onToggle: () => void }) {
  let logs: { adminEmail?: string; adminId?: string; time: string; items?: { name: string; price: number | null; quantity: number; leadTime?: string }[] }[] = [];
  try { logs = JSON.parse(operationLogs || '[]'); } catch {}
  if (logs.length === 0) return null;
  const latest = logs[logs.length - 1];

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <button onClick={onToggle}
        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
        {expanded ? '收起' : '查看'}报价记录（共 {logs.length} 条）
        <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2">
          {logs.map((log, idx) => (
            <div key={idx} className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs">
              <div className="flex justify-between text-blue-700 mb-1">
                <span className="font-medium">{log.adminEmail || log.adminId}</span>
                <span>{new Date(log.time).toLocaleString('zh-CN')}</span>
              </div>
              <div className="space-y-1">
                {log.items?.map((it, i) => (
                  <div key={i} className="text-gray-700">· {it.name} | 单价: ¥{it.price} | 数量: {it.quantity} | 货期: {it.leadTime || '-'}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs">
          <div className="flex justify-between text-blue-700 mb-1">
            <span className="font-medium">{latest.adminEmail || latest.adminId}</span>
            <span>{new Date(latest.time).toLocaleString('zh-CN')}</span>
          </div>
          <div className="space-y-1">
            {latest.items?.map((it, i) => (
              <div key={i} className="text-gray-700">· {it.name} | 单价: ¥{it.price} | 数量: {it.quantity} | 货期: {it.leadTime || '-'}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
