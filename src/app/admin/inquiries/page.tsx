'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Package, Archive, Check, Clock, XCircle, MessageSquare,
} from 'lucide-react';
import { InquiryIdDisplay } from '@/components/InquiryIdDisplay';
import { AdminInquiryTimelineWorkspace } from '@/components/admin/AdminInquiryTimelineWorkspace';
import type { AdminInquiryRecord } from '@/lib/admin-inquiry-timeline';
import { effectiveInquiryStatus } from '@/lib/quote-expiry';

const GRID_COLUMNS_CLASS =
  'xl:grid xl:grid-cols-[1.75rem_minmax(0,1.55fr)_minmax(0,1.35fr)_minmax(0,1fr)_5.25rem_6.5rem_4.25rem_2.75rem] xl:items-center xl:gap-2.5';

export default function AdminInquiriesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-brand-600" /> 活跃询价
        </h1>
        <p className="text-sm text-gray-500 mt-1">查看和处理所有进行中的询价单（待处理/已报价/已过期/已接受）</p>
      </div>
      <InquiriesPanel />
    </div>
  );
}

function InquiriesPanel() {
  const router = useRouter();
  const [inquiries, setInquiries] = useState<AdminInquiryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [inquiryDateFrom, setInquiryDateFrom] = useState('');
  const [inquiryDateTo, setInquiryDateTo] = useState('');
  const [selectedInquiry, setSelectedInquiry] = useState<AdminInquiryRecord | null>(null);
  const [selectedInquiries, setSelectedInquiries] = useState<Set<string>>(new Set());
  const initialQueryAppliedRef = useRef(false);

  const fetchData = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const res = await fetch('/api/inquiries');
      const data = await res.json();
      const rows: AdminInquiryRecord[] = Array.isArray(data) ? data : [];
      setInquiries(rows);
      let initialTargetId: string | null = null;
      if (!initialQueryAppliedRef.current) {
        initialQueryAppliedRef.current = true;
        initialTargetId = new URLSearchParams(window.location.search).get('inquiryId');
      }
      setSelectedInquiry((current) => {
        const targetId = current?.id ?? initialTargetId;
        return targetId ? (rows.find((row) => row.id === targetId) ?? null) : null;
      });
    } catch (e) {
      console.error(e);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  async function archiveInquiries(inquiryIds: string[]) {
    if (!confirm(`确定要归档 ${inquiryIds.length} 个询价单吗？`)) return;
    try {
      const res = await fetch('/api/admin/inquiries/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inquiryIds, action: 'archive' }),
      });
      if (res.ok) {
        setSelectedInquiries((current) => {
          const next = new Set(current);
          for (const id of inquiryIds) next.delete(id);
          return next;
        });
        fetchData();
        setSelectedInquiry(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  const filteredInquiries = inquiries.filter((i) => {
    const matchSearch = !search
      || i.name.includes(search)
      || i.email.includes(search)
      || (i.institution && i.institution.includes(search))
      || i.id.includes(search);
    const inquiryDate = new Date(i.createdAt);
    const matchDateFrom = !inquiryDateFrom || inquiryDate >= new Date(inquiryDateFrom);
    const matchDateTo = !inquiryDateTo || inquiryDate <= new Date(inquiryDateTo + 'T23:59:59');
    return matchSearch && matchDateFrom && matchDateTo;
  });
  const visibleSelectedIds = filteredInquiries.map((i) => i.id).filter((id) => selectedInquiries.has(id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-auto">
          <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索询价单..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full sm:w-64 text-gray-900"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">从</span>
          <input
            type="date"
            value={inquiryDateFrom}
            onChange={(e) => setInquiryDateFrom(e.target.value)}
            className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
          />
          <span className="text-sm text-gray-500">至</span>
          <input
            type="date"
            value={inquiryDateTo}
            onChange={(e) => setInquiryDateTo(e.target.value)}
            className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
          />
          {(inquiryDateFrom || inquiryDateTo) && (
            <button
              type="button"
              onClick={() => { setInquiryDateFrom(''); setInquiryDateTo(''); }}
              className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              清除
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => router.push('/admin/inquiries/archived')}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium flex items-center gap-1.5"
        >
          <Package className="w-4 h-4" /> 已归档
        </button>
        {visibleSelectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => archiveInquiries(visibleSelectedIds)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
          >
            <Archive className="w-4 h-4" /> 批量归档 ({visibleSelectedIds.length})
          </button>
        )}
      </div>

      <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/70 overflow-hidden min-w-0">
        <div className={`bg-gray-50/80 border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 flex items-center gap-3 min-w-0 ${GRID_COLUMNS_CLASS}`}>
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="checkbox"
              aria-label="全选当前筛选结果"
              checked={filteredInquiries.length > 0 && visibleSelectedIds.length === filteredInquiries.length}
              onChange={(e) => {
                setSelectedInquiries(e.target.checked ? new Set(filteredInquiries.map((i) => i.id)) : new Set());
              }}
              className="w-4 h-4 text-brand-600 rounded border-gray-300"
            />
            <span className="xl:hidden text-xs font-medium text-gray-600">全选当前筛选结果</span>
          </div>
          <span className="hidden xl:block min-w-0">编号</span>
          <span className="hidden xl:block min-w-0">客户</span>
          <span className="hidden xl:block min-w-0">机构</span>
          <span className="hidden xl:block min-w-0">金额</span>
          <span className="hidden xl:block min-w-0">状态</span>
          <span className="hidden xl:block min-w-0">时间</span>
          <span className="hidden xl:block min-w-0">操作</span>
        </div>

        <div>
          {filteredInquiries.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-600">暂无询价单</div>
          ) : filteredInquiries.map((inquiry) => (
            <InquiryRow
              key={inquiry.id}
              inquiry={inquiry}
              isExpanded={selectedInquiry?.id === inquiry.id}
              onToggleExpand={() => setSelectedInquiry(selectedInquiry?.id === inquiry.id ? null : inquiry)}
              isSelected={selectedInquiries.has(inquiry.id)}
              onToggleSelect={(checked) => {
                const next = new Set(selectedInquiries);
                if (checked) next.add(inquiry.id);
                else next.delete(inquiry.id);
                setSelectedInquiries(next);
              }}
              fetchData={fetchData}
              onArchive={() => archiveInquiries([inquiry.id])}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function InquiryRow({
  inquiry,
  isExpanded,
  onToggleExpand,
  isSelected,
  onToggleSelect,
  fetchData,
  onArchive,
}: {
  inquiry: AdminInquiryRecord;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isSelected: boolean;
  onToggleSelect: (checked: boolean) => void;
  fetchData: (options?: { silent?: boolean }) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const shownStatus = effectiveInquiryStatus(inquiry.status, inquiry.activeQuote);
  const pendingFeedbackCount = inquiry.feedbackSummary?.pendingCount ?? 0;
  const createdAtDate = new Date(inquiry.createdAt);
  const createdAtLabel = Number.isNaN(createdAtDate.getTime())
    ? '—'
    : createdAtDate.toLocaleDateString('zh-CN');

  return (
    <div className="min-w-0">
      <div
        data-testid={`inquiry-row-${inquiry.id}`}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (
            (e.key === 'Enter' || e.key === ' ')
            && !(e.target instanceof HTMLElement && e.target !== e.currentTarget && e.target.closest('button, a, input, select, textarea'))
          ) {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className={`border-b border-gray-100 px-4 py-3 cursor-pointer text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${isExpanded ? 'bg-brand-50/50' : 'hover:bg-gray-50/50'}`}
      >
        <div className={`grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1.5 min-w-0 ${GRID_COLUMNS_CLASS}`}>
          <div className="col-start-1 row-start-1 min-w-0 pt-0.5 xl:pt-0" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              aria-label={`选择询价单 ${inquiry.id}`}
              checked={isSelected}
              onChange={(e) => onToggleSelect(e.target.checked)}
              className="w-4 h-4 text-brand-600 rounded border-gray-300"
            />
          </div>

          <div className="col-start-2 row-start-1 min-w-0 xl:col-start-2 xl:row-start-1">
            <InquiryIdDisplay id={inquiry.id} size="compact" className="text-gray-700" />
          </div>

          <div className="col-start-2 col-span-2 row-start-2 min-w-0 xl:col-span-1 xl:col-start-3 xl:row-start-1">
            <div className="font-medium text-gray-900 break-words break-all">{inquiry.name}（{inquiry.email}）</div>
          </div>

          <div className="col-start-2 col-span-2 row-start-3 min-w-0 text-gray-700 break-words xl:col-span-1 xl:col-start-4 xl:row-start-1">
            {inquiry.institution}
          </div>

          <div className="col-start-2 row-start-4 min-w-0 font-semibold text-gray-900 xl:col-start-5 xl:row-start-1">
            {inquiry.hasUnresolvedPricing
              ? '待报价确认'
              : `¥${inquiry.subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}
          </div>

          <div className="col-start-2 col-span-2 row-start-5 min-w-0 xl:col-span-1 xl:col-start-6 xl:row-start-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                shownStatus === 'closed' ? 'bg-gray-100 text-gray-600' :
                shownStatus === 'pending_quote' ? 'bg-yellow-100 text-yellow-700' :
                shownStatus === 'quote_expired' ? 'bg-amber-100 text-amber-800' :
                shownStatus === 'quote_sent' ? 'bg-blue-100 text-blue-700' :
                shownStatus === 'declined' ? 'bg-gray-100 text-gray-600' :
                'bg-green-100 text-green-700'
              }`}>
                {shownStatus === 'closed' || shownStatus === 'declined' ? <XCircle className="w-3 h-3" /> :
                 shownStatus === 'pending_quote' || shownStatus === 'quote_expired' ? <Clock className="w-3 h-3" /> :
                 <Check className="w-3 h-3" />}
                {shownStatus === 'closed' ? '已关闭' :
                 shownStatus === 'declined' ? '已放弃' :
                 shownStatus === 'pending_quote' ? '待报价' :
                 shownStatus === 'quote_expired' ? '已过期' :
                 shownStatus === 'quote_sent' ? '已发报价' : shownStatus}
              </span>
              {pendingFeedbackCount > 0 && (
                <span
                  data-testid={`pending-feedback-badge-${inquiry.id}`}
                  className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800"
                >
                  待处理反馈 {pendingFeedbackCount}
                </span>
              )}
            </div>
          </div>

          <div className="col-start-3 row-start-4 min-w-0 justify-self-end text-gray-600 text-xs xl:col-start-7 xl:row-start-1 xl:justify-self-start">
            {createdAtLabel}
          </div>

          <div
            className="col-start-3 row-start-1 min-w-0 justify-self-end xl:col-start-8 xl:row-start-1 xl:justify-self-start"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void onArchive(); }}
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-purple-600 hover:bg-purple-50 hover:text-purple-700"
                title="归档"
                aria-label="归档"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="bg-brand-50/70 p-3 sm:p-4 border-b border-brand-200 min-w-0">
          <AdminInquiryTimelineWorkspace
            key={inquiry.id}
            inquiry={inquiry}
            fetchData={fetchData}
          />
        </div>
      )}
    </div>
  );
}
