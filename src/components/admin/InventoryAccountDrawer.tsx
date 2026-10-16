'use client';

import { useEffect, useRef } from 'react';
import { History, PackageCheck, X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type InventoryBatchRow = {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate?: string | null;
};

export type InventoryTransactionRow = {
  id: string;
  quantity: number;
  reason: string;
  createdAt: string;
};

export type InventoryAccountDetail = {
  id: string;
  batches: InventoryBatchRow[];
  transactions: InventoryTransactionRow[];
};

export type InventoryAdjustmentForm = {
  actualQuantity: string;
  inboundQuantity: string;
  reason: string;
};

export type InventoryBatchForm = {
  batchNumber: string;
  quantity: string;
  expiryDate: string;
};

type DetailStatus = 'idle' | 'loading' | 'ready' | 'error';

type InventoryAccountDrawerProps = {
  name: string;
  subtitle: string;
  quantities: {
    actualQuantity: number;
    availableQuantity: number;
    reservedQuantity: number;
    shippedQuantity: number;
    inboundQuantity: number;
  };
  detail: InventoryAccountDetail | null;
  detailStatus: DetailStatus;
  detailError: string;
  actionError: string;
  form: InventoryAdjustmentForm;
  batch: InventoryBatchForm;
  saving: boolean;
  receiving: boolean;
  onClose: () => void;
  onFormChange: (form: InventoryAdjustmentForm) => void;
  onBatchChange: (batch: InventoryBatchForm) => void;
  onSave: () => void;
  onReceive: () => void;
  onRetryDetail: () => void;
};

function quantity(value: number) {
  return value < 0 ? '未知' : value.toLocaleString('zh-CN');
}

function focusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
}

const fieldClass = `w-full min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm ${uiSurfaces.focusRing}`;
const primaryButtonClass = 'px-4 py-2 bg-brand-600 text-white rounded-lg text-sm disabled:opacity-50';

export default function InventoryAccountDrawer({
  name,
  subtitle,
  quantities,
  detail,
  detailStatus,
  detailError,
  actionError,
  form,
  batch,
  saving,
  receiving,
  onClose,
  onFormChange,
  onBatchChange,
  onSave,
  onReceive,
  onRetryDetail,
}: InventoryAccountDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const nodes = focusable(dialog);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const showLists = Boolean(detail) && detailStatus !== 'loading';
  const stats = [
    ['实际', quantities.actualQuantity],
    ['可售', quantities.availableQuantity],
    ['预占', quantities.reservedQuantity],
    ['已发货', quantities.shippedQuantity],
    ['采购在途', quantities.inboundQuantity],
  ] as const;

  return (
    <div className="fixed inset-0 z-site-overlay">
      <button type="button" aria-label="关闭库存详情" className={`absolute inset-0 ${uiSurfaces.modalBackdrop}`} onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-drawer-title"
        aria-busy={detailStatus === 'loading'}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col overflow-hidden ${uiSurfaces.modal}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id="inventory-drawer-title" className="truncate text-lg font-semibold text-gray-900" title={name}>{name}</h2>
            <p className="mt-1 truncate text-xs text-gray-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className={`shrink-0 rounded-lg p-1 text-gray-400 hover:text-gray-600 ${uiSurfaces.focusRing}`}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {stats.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className={`text-sm ${label === '可售' ? 'font-medium text-brand-700' : 'text-gray-900'}`}>{quantity(value)}</dd>
              </div>
            ))}
          </dl>

          {actionError && (
            <p role="alert" className="rounded-lg border border-[var(--brand-color-error-border)] bg-[var(--brand-color-error-bg)] px-3 py-2 text-sm text-[var(--brand-color-error-text)]">{actionError}</p>
          )}

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium text-gray-900"><PackageCheck className="h-4 w-4" /> 库存调整</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs text-gray-500">
                实际库存
                <input
                  type="number"
                  min={-1}
                  value={form.actualQuantity}
                  onChange={(event) => onFormChange({ ...form, actualQuantity: event.target.value })}
                  placeholder="实际库存，-1 未知"
                  className={`${fieldClass} mt-1`}
                />
              </label>
              <label className="block text-xs text-gray-500">
                采购在途
                <input
                  type="number"
                  min={0}
                  value={form.inboundQuantity}
                  onChange={(event) => onFormChange({ ...form, inboundQuantity: event.target.value })}
                  placeholder="采购在途"
                  className={`${fieldClass} mt-1`}
                />
              </label>
            </div>
            <label className="block text-xs text-gray-500">
              调整原因
              <input
                value={form.reason}
                onChange={(event) => onFormChange({ ...form, reason: event.target.value })}
                placeholder="调整原因"
                className={`${fieldClass} mt-1`}
              />
            </label>
            <button type="button" onClick={onSave} disabled={saving || receiving} className={primaryButtonClass}>{saving ? '正在保存' : '保存调整'}</button>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium text-gray-900">批次入库</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs text-gray-500">
                批次号
                <input
                  value={batch.batchNumber}
                  onChange={(event) => onBatchChange({ ...batch, batchNumber: event.target.value })}
                  placeholder="批次号"
                  className={`${fieldClass} mt-1`}
                />
              </label>
              <label className="block text-xs text-gray-500">
                入库数量
                <input
                  type="number"
                  min={1}
                  value={batch.quantity}
                  onChange={(event) => onBatchChange({ ...batch, quantity: event.target.value })}
                  placeholder="入库数量"
                  className={`${fieldClass} mt-1`}
                />
              </label>
              <label className="block text-xs text-gray-500">
                有效期
                <input
                  type="date"
                  value={batch.expiryDate}
                  onChange={(event) => onBatchChange({ ...batch, expiryDate: event.target.value })}
                  className={`${fieldClass} mt-1`}
                />
              </label>
            </div>
            <button type="button" onClick={onReceive} disabled={saving || receiving} className={primaryButtonClass}>{receiving ? '正在入库' : '确认入库'}</button>
            {detailStatus === 'loading' && <p role="status" className={`text-sm ${uiSurfaces.mutedText}`}>正在加载批次和流水</p>}
            {detailError && (
              <div role="alert" className="space-y-2 rounded-lg border border-[var(--brand-color-error-border)] bg-[var(--brand-color-error-bg)] px-3 py-2 text-sm text-[var(--brand-color-error-text)]">
                <p>{detailError}</p>
                <button type="button" onClick={onRetryDetail} className="rounded-lg border border-current px-3 py-1 text-sm">重新加载</button>
              </div>
            )}
            {showLists && detail && detail.batches.length === 0 && <p className={`text-sm ${uiSurfaces.mutedText}`}>暂无批次</p>}
            {showLists && detail?.batches.map((item) => (
              <p key={item.id} className="break-all text-sm text-gray-600">
                {item.batchNumber} · {item.quantity} · {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('zh-CN') : '无有效期'}
              </p>
            ))}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900"><History className="h-4 w-4" /> 最近流水</h3>
            {showLists && detail && detail.transactions.length === 0 && <p className={`text-sm ${uiSurfaces.mutedText}`}>暂无流水</p>}
            {showLists && detail?.transactions.map((item) => (
              <div key={item.id} className="flex justify-between gap-4 border-t border-gray-100 py-2 text-sm">
                <span className="min-w-0 break-all">{item.reason}</span>
                <span className="shrink-0 text-gray-500">{item.quantity > 0 ? '+' : ''}{item.quantity} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
