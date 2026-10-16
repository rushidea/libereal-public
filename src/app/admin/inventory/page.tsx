'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Warehouse } from 'lucide-react';
import InventoryAccountDrawer, {
  type InventoryAccountDetail,
  type InventoryAdjustmentForm,
  type InventoryBatchForm,
} from '@/components/admin/InventoryAccountDrawer';
import { inventoryAdminErrorMessage } from '@/lib/inventory-admin-messages';
import { uiSurfaces } from '@/lib/ui-surfaces';

type AccountSummary = {
  id: string;
  productId: string;
  variantId?: string | null;
  actualQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  shippedQuantity: number;
  inboundQuantity: number;
  batchCount: number;
  product: { catalogNumber: string; name: string; brand: string };
  variant?: { catalogNumber: string; spec: string } | null;
};

type AccountDetail = AccountSummary & InventoryAccountDetail;

type ListStatus = 'loading' | 'ready' | 'error';

const emptyForm = (): InventoryAdjustmentForm => ({ actualQuantity: '', inboundQuantity: '', reason: '' });
const emptyBatch = (): InventoryBatchForm => ({ batchNumber: '', quantity: '', expiryDate: '' });

function quantity(value: number) {
  return value < 0 ? '未知' : value.toLocaleString('zh-CN');
}

function subtitle(account: AccountSummary) {
  return `${account.variant?.catalogNumber || account.product.catalogNumber} · ${account.product.brand}`;
}

export default function InventoryPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [search, setSearch] = useState('');
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [detailError, setDetailError] = useState('');
  const [actionError, setActionError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [batch, setBatch] = useState(emptyBatch);
  const [saving, setSaving] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const selectedIdRef = useRef<string | null>(null);

  const load = useCallback(async (term: string, mode: 'replace' | 'refresh' = 'replace') => {
    const requestId = ++listRequest.current;
    if (mode === 'replace') {
      setListStatus('loading');
      setListError('');
    }
    try {
      const response = await fetch(`/api/admin/inventory?search=${encodeURIComponent(term.trim())}`);
      const data = await response.json().catch(() => null);
      if (listRequest.current !== requestId) return;
      if (!response.ok || !data) {
        setListError(inventoryAdminErrorMessage(data?.error, '库存列表加载失败，请重试。'));
        if (mode === 'replace') setListStatus('error');
        return;
      }
      const rows = (data.accounts || []) as AccountSummary[];
      const currentId = selectedIdRef.current;
      const stillOpen = Boolean(currentId && rows.some((row) => row.id === currentId));
      setAccounts(rows);
      setListStatus('ready');
      setListError('');
      if (currentId && !stillOpen) {
        detailRequest.current += 1;
        selectedIdRef.current = null;
        setSelectedId(null);
        setDetail(null);
        setDetailStatus('idle');
        setDetailError('');
      }
    } catch {
      if (listRequest.current !== requestId) return;
      setListError('库存列表加载失败，请检查网络后重试。');
      if (mode === 'replace') setListStatus('error');
    }
  }, []);

  const loadDetail = useCallback(async (accountId: string, mode: 'replace' | 'refresh' = 'replace') => {
    const requestId = ++detailRequest.current;
    if (mode === 'replace') {
      setDetail(null);
      setDetailStatus('loading');
      setDetailError('');
    }
    try {
      const response = await fetch(`/api/admin/inventory?accountId=${encodeURIComponent(accountId)}`);
      const data = await response.json().catch(() => null);
      if (detailRequest.current !== requestId || selectedIdRef.current !== accountId) return;
      if (!response.ok || !data?.account) {
        if (mode === 'replace') setDetail(null);
        setDetailStatus('error');
        setDetailError(inventoryAdminErrorMessage(data?.error, '批次和流水加载失败，请重试。'));
        return;
      }
      const account = data.account as AccountDetail;
      setDetail(account);
      setDetailStatus('ready');
      setDetailError('');
      setAccounts((current) => current.map((row) => row.id === account.id ? {
        ...row,
        actualQuantity: account.actualQuantity,
        availableQuantity: account.availableQuantity,
        reservedQuantity: account.reservedQuantity,
        shippedQuantity: account.shippedQuantity,
        inboundQuantity: account.inboundQuantity,
        batchCount: account.batches.length,
      } : row));
    } catch {
      if (detailRequest.current !== requestId) return;
      if (mode === 'replace') setDetail(null);
      setDetailStatus('error');
      setDetailError('批次和流水加载失败，请检查网络后重试。');
    }
  }, []);

  useEffect(() => { void load(''); }, [load]);

  const selected = accounts.find((account) => account.id === selectedId) || null;

  const openAccount = (account: AccountSummary) => {
    selectedIdRef.current = account.id;
    setSelectedId(account.id);
    setActionError('');
    setForm(emptyForm());
    setBatch(emptyBatch());
    void loadDetail(account.id);
  };

  const closeDrawer = useCallback(() => {
    detailRequest.current += 1;
    selectedIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDetailStatus('idle');
    setDetailError('');
    setActionError('');
  }, []);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setActionError('');
    try {
      const response = await fetch('/api/admin/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selected.productId,
          variantId: selected.variantId || null,
          ...(form.actualQuantity !== '' ? { actualQuantity: Number(form.actualQuantity) } : {}),
          ...(form.inboundQuantity !== '' ? { inboundQuantity: Number(form.inboundQuantity) } : {}),
          reason: form.reason,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(inventoryAdminErrorMessage(data?.error, '保存失败，请稍后重试。'));
        return;
      }
      setForm(emptyForm());
      await Promise.all([load(search, 'refresh'), loadDetail(selected.id, 'refresh')]);
    } catch {
      setActionError('保存失败，请检查网络后重试。');
    } finally {
      setSaving(false);
    }
  };

  const receive = async () => {
    if (!selected) return;
    if (!batch.batchNumber.trim() || !batch.quantity) {
      setActionError('请填写批次号，入库数量须为正整数。');
      return;
    }
    setReceiving(true);
    setActionError('');
    try {
      const response = await fetch('/api/admin/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selected.productId,
          variantId: selected.variantId || null,
          batchNumber: batch.batchNumber,
          quantity: Number(batch.quantity),
          expiryDate: batch.expiryDate || null,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(inventoryAdminErrorMessage(data?.error, '入库失败，请稍后重试。'));
        return;
      }
      setBatch(emptyBatch());
      await Promise.all([load(search, 'refresh'), loadDetail(selected.id, 'refresh')]);
    } catch {
      setActionError('入库失败，请检查网络后重试。');
    } finally {
      setReceiving(false);
    }
  };

  const emptyCopy = search.trim() ? '没有找到匹配的库存账户' : '暂无库存账户';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><Warehouse className="h-6 w-6 text-brand-600" /><h1 className="text-2xl font-bold text-gray-900">库存与批次</h1></div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void load(search); }}
            placeholder="搜索货号、产品或品牌"
            aria-label="搜索货号、产品或品牌"
            className={`w-full py-2 pl-9 pr-3 border border-gray-200 rounded-lg text-sm ${uiSurfaces.focusRing}`}
          />
        </div>
        <button type="button" onClick={() => void load(search)} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm">查询</button>
      </div>

      {listStatus === 'loading' && <p role="status" className={`text-sm ${uiSurfaces.mutedText}`}>正在加载库存</p>}
      {listError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--brand-color-error-border)] bg-[var(--brand-color-error-bg)] px-3 py-2 text-sm text-[var(--brand-color-error-text)]">
          <p>{listError}</p>
          <button type="button" onClick={() => void load(search)} className="rounded-lg border border-current px-3 py-1">重试</button>
        </div>
      )}

      <div className="overflow-x-auto border-y border-gray-200">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-3">产品</th><th>实际</th><th>可售</th><th>预占</th><th>已发货</th><th>采购在途</th><th>批次</th>
            </tr>
          </thead>
          <tbody>
            {listStatus === 'ready' && accounts.length === 0 && (
              <tr><td colSpan={7} className={`px-3 py-12 text-center ${uiSurfaces.mutedText}`}>{emptyCopy}</td></tr>
            )}
            {accounts.map((account) => (
              <tr
                key={account.id}
                tabIndex={0}
                aria-selected={selectedId === account.id}
                aria-haspopup="dialog"
                onClick={(event) => {
                  event.currentTarget.focus();
                  openAccount(account);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openAccount(account);
                  }
                }}
                className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${selectedId === account.id ? 'bg-brand-50' : ''}`}
              >
                <td className="py-3">
                  <p className="font-medium text-gray-900">{account.product.name}</p>
                  <p className="font-mono text-xs text-gray-500">{subtitle(account)}</p>
                </td>
                <td>{quantity(account.actualQuantity)}</td>
                <td className="font-medium text-brand-700">{quantity(account.availableQuantity)}</td>
                <td>{quantity(account.reservedQuantity)}</td>
                <td>{quantity(account.shippedQuantity)}</td>
                <td>{quantity(account.inboundQuantity)}</td>
                <td>{account.batchCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <InventoryAccountDrawer
          name={selected.product.name}
          subtitle={subtitle(selected)}
          quantities={detail ?? selected}
          detail={detail}
          detailStatus={detailStatus}
          detailError={detailError}
          actionError={actionError}
          form={form}
          batch={batch}
          saving={saving}
          receiving={receiving}
          onClose={closeDrawer}
          onFormChange={setForm}
          onBatchChange={setBatch}
          onSave={() => void save()}
          onReceive={() => void receive()}
          onRetryDetail={() => void loadDetail(selected.id)}
        />
      )}
    </div>
  );
}
