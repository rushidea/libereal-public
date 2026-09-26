'use client';

import { useEffect, useState } from 'react';
import { History, PackageCheck, Search, Warehouse } from 'lucide-react';

type Account = {
  id: string; productId: string; variantId?: string; actualQuantity: number; availableQuantity: number;
  reservedQuantity: number; shippedQuantity: number; inboundQuantity: number;
  product: { catalogNumber: string; name: string; brand: string };
  variant?: { catalogNumber: string; spec: string };
  batches: Array<{ id: string; batchNumber: string; quantity: number; expiryDate?: string }>;
  transactions: Array<{ id: string; type: string; quantity: number; reason: string; createdAt: string }>;
};

function quantity(value: number) { return value < 0 ? '未知' : value.toLocaleString('zh-CN'); }

export default function InventoryPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Account | null>(null);
  const [form, setForm] = useState({ actualQuantity: '', inboundQuantity: '', reason: '' });
  const [batch, setBatch] = useState({ batchNumber: '', quantity: '', expiryDate: '' });

  const load = async (term = search) => {
    const response = await fetch(`/api/admin/inventory?search=${encodeURIComponent(term.trim())}`);
    if (response.ok) {
      const rows = (await response.json()).accounts || [];
      setAccounts(rows);
      if (selected) setSelected(rows.find((row: Account) => row.id === selected.id) || null);
    }
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(''); }, []);

  const save = async () => {
    if (!selected) return;
    const response = await fetch('/api/admin/inventory', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: selected.productId, variantId: selected.variantId || null,
        ...(form.actualQuantity !== '' ? { actualQuantity: Number(form.actualQuantity) } : {}),
        ...(form.inboundQuantity !== '' ? { inboundQuantity: Number(form.inboundQuantity) } : {}),
        reason: form.reason,
      }),
    });
    if (response.ok) { setForm({ actualQuantity: '', inboundQuantity: '', reason: '' }); await load(); }
    else alert((await response.json()).error || '保存失败');
  };

  const receive = async () => {
    if (!selected || !batch.batchNumber.trim() || !batch.quantity) return;
    const response = await fetch('/api/admin/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: selected.productId, variantId: selected.variantId || null, batchNumber: batch.batchNumber, quantity: Number(batch.quantity), expiryDate: batch.expiryDate || null }),
    });
    if (response.ok) { setBatch({ batchNumber: '', quantity: '', expiryDate: '' }); await load(); }
    else alert((await response.json()).error || '入库失败');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><Warehouse className="w-6 h-6 text-brand-600" /><h1 className="text-2xl font-bold text-gray-900">库存与批次</h1></div>
      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void load()} placeholder="搜索货号、产品或品牌" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
        <button onClick={() => load()} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm">查询</button>
      </div>

      <div className="overflow-x-auto border-y border-gray-200">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr className="text-left text-gray-500"><th className="py-3">产品</th><th>实际</th><th>可售</th><th>预占</th><th>已发货</th><th>采购在途</th><th>批次</th></tr></thead>
          <tbody>{accounts.map((account) => <tr key={account.id} onClick={() => setSelected(account)} className="border-t border-gray-100 cursor-pointer hover:bg-gray-50">
            <td className="py-3"><p className="font-medium text-gray-900">{account.product.name}</p><p className="font-mono text-xs text-gray-500">{account.variant?.catalogNumber || account.product.catalogNumber} · {account.product.brand}</p></td>
            <td>{quantity(account.actualQuantity)}</td><td className="font-medium text-brand-700">{quantity(account.availableQuantity)}</td><td>{quantity(account.reservedQuantity)}</td><td>{quantity(account.shippedQuantity)}</td><td>{quantity(account.inboundQuantity)}</td><td>{account.batches.length}</td>
          </tr>)}</tbody>
        </table>
      </div>

      {selected && <div className="border-t border-gray-200 pt-5 space-y-5">
        <h2 className="text-lg font-semibold text-gray-900">{selected.product.name}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="space-y-3"><h3 className="font-medium flex items-center gap-2"><PackageCheck className="w-4 h-4" /> 库存调整</h3>
            <div className="grid grid-cols-2 gap-3"><input type="number" min="-1" value={form.actualQuantity} onChange={(event) => setForm({ ...form, actualQuantity: event.target.value })} placeholder="实际库存，-1 未知" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" /><input type="number" min="0" value={form.inboundQuantity} onChange={(event) => setForm({ ...form, inboundQuantity: event.target.value })} placeholder="采购在途" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
            <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="调整原因" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            <button onClick={save} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm">保存调整</button>
          </section>
          <section className="space-y-3"><h3 className="font-medium">批次入库</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><input value={batch.batchNumber} onChange={(event) => setBatch({ ...batch, batchNumber: event.target.value })} placeholder="批次号" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" /><input type="number" min="1" value={batch.quantity} onChange={(event) => setBatch({ ...batch, quantity: event.target.value })} placeholder="入库数量" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" /><input type="date" value={batch.expiryDate} onChange={(event) => setBatch({ ...batch, expiryDate: event.target.value })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" /></div>
            <button onClick={receive} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm">确认入库</button>
            {selected.batches.map((item) => <p key={item.id} className="text-sm text-gray-600">{item.batchNumber} · {item.quantity} · {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('zh-CN') : '无有效期'}</p>)}
          </section>
        </div>
        <section><h3 className="font-medium flex items-center gap-2 mb-2"><History className="w-4 h-4" /> 最近流水</h3>{selected.transactions.map((item) => <div key={item.id} className="flex justify-between gap-4 border-t border-gray-100 py-2 text-sm"><span>{item.reason}</span><span className="text-gray-500">{item.quantity > 0 ? '+' : ''}{item.quantity} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span></div>)}</section>
      </div>}
    </div>
  );
}
