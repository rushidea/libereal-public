'use client';

import { useState, useEffect, useRef } from 'react';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { MapPin, Plus, Trash2, Star, Edit2, CheckCircle } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';

interface Address {
  id: string;
  name: string;
  phone: string;
  address: string;
  institution: string | null;
  label: string | null;
  isDefault: number;
}

// 抽取成 uncontrolled form component —— 完全绕开 React state 绑定 input
// 用 FormData 在 submit 时读 input 值，避免 React 任何 value/onChange 同步问题
function AddressForm({
  defaultValues,
  saving,
  onSave,
  onCancel,
}: {
  defaultValues: { name: string; phone: string; address: string; institution: string };
  saving: boolean;
  onSave: (data: { name: string; phone: string; address: string; institution: string }) => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(formRef.current!);
    const name = String(fd.get('name') || '').trim();
    const phone = String(fd.get('phone') || '').trim();
    const address = String(fd.get('address') || '').trim();
    const institution = String(fd.get('institution') || '').trim();
    if (!name || !phone || !address) {
      if (errorRef.current) {
        errorRef.current.textContent = '请填写收货人、手机和收货地址';
        errorRef.current.style.display = 'block';
      }
      return;
    }
    onSave({ name, phone, address, institution });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="bg-white dark:bg-slate-200/65 rounded-xl border border-gray-200 dark:border-slate-400 p-5">
      <div
        ref={errorRef}
        style={{ display: 'none' }}
        className="mb-4 p-3 bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/40 rounded-xl text-red-600 dark:text-red-500 text-sm"
      />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">收货人 <span className="text-red-500">*</span></label>
            <input
              name="name"
              type="text"
              defaultValue={defaultValues.name}
              placeholder="姓名"
              autoComplete="off"
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">手机 <span className="text-red-500">*</span></label>
            <input
              name="phone"
              type="tel"
              defaultValue={defaultValues.phone}
              placeholder="手机号码"
              autoComplete="off"
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">收货地址 <span className="text-red-500">*</span></label>
          <input
            name="address"
            type="text"
            defaultValue={defaultValues.address}
            placeholder="详细收货地址"
            autoComplete="off"
            className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">单位/实验室 <span className="text-gray-400 text-xs">(选填)</span></label>
          <input
            name="institution"
            type="text"
            defaultValue={defaultValues.institution}
            placeholder="单位名称或实验室名称"
            autoComplete="off"
            className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
          />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  );
}

export default function AccountAddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDefaults, setEditDefaults] = useState({ name: '', phone: '', address: '', institution: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchAddresses = () => {
    fetch('/api/addresses')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setAddresses(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchAddresses(); }, []);

  const handleSave = async (data: { name: string; phone: string; address: string; institution: string }) => {
    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch(`/api/addresses/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('更新失败');
      } else {
        const res = await fetch('/api/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, isDefault: addresses.length === 0 }),
        });
        if (!res.ok) throw new Error('创建失败');
      }
      setShowForm(false);
      setEditingId(null);
      setEditDefaults({ name: '', phone: '', address: '', institution: '' });
      fetchAddresses();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (addr: Address) => {
    setEditDefaults({ name: addr.name, phone: addr.phone, address: addr.address, institution: addr.institution || '' });
    setEditingId(addr.id);
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditDefaults({ name: '', phone: '', address: '', institution: '' });
    setEditingId(null);
    setShowForm(true);
  };

  const handleSetDefault = async (id: string) => {
    await fetch(`/api/addresses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    fetchAddresses();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该收货地址？')) return;
    setDeleting(id);
    try {
      await fetch(`/api/addresses/${id}`, { method: 'DELETE' });
      fetchAddresses();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 pb-8">
        <Breadcrumb items={[
          { label: '首页', href: '/' },
          { label: '我的账户', href: '/account' },
          { label: '收货地址' }
        ]} />

        <div className="mb-4 bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4">
          <div className="flex items-center gap-2">
            <MapPin className="text-brand-600" size={22} />
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">收货地址</h1>
              <p className="text-xs text-gray-400 mt-0.5">管理您的收货地址</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">加载中...</div>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              {addresses.map(addr => (
                <div key={addr.id} className={`bg-white dark:bg-slate-200/65 rounded-xl border p-4 ${addr.isDefault ? 'border-brand-300 dark:border-brand-500/50 bg-brand-50/30 dark:bg-brand-500/10' : 'border-gray-100 dark:border-slate-400'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <MapPin className={`w-5 h-5 mt-0.5 flex-shrink-0 ${addr.isDefault ? 'text-brand-500' : 'text-gray-300 dark:text-gray-500'}`} />
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900 dark:text-slate-900">{addr.name}</span>
                          <span className="text-gray-500 dark:text-gray-500 text-sm">{addr.phone}</span>
                          {addr.isDefault === 1 && (
                            <span className="text-xs px-2 py-0.5 bg-brand-100 dark:bg-brand-500/30 text-brand-700 dark:text-brand-500 rounded flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> 默认
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-600">
                          {addr.institution && <span className="text-gray-500 dark:text-gray-500">{addr.institution} · </span>}
                          {addr.address}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {addr.isDefault !== 1 && (
                        <button
                          onClick={() => handleSetDefault(addr.id)}
                          title="设为默认"
                          className="p-1.5 text-gray-300 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
                        >
                          <Star className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(addr)}
                        className="p-1.5 text-gray-300 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-500 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(addr.id)}
                        disabled={deleting === addr.id}
                        className="p-1.5 text-gray-300 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {addresses.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无收货地址</p>
                </div>
              )}
            </div>

            {/* Add/Edit form — uncontrolled with FormData */}
            {showForm ? (
              <AddressForm
                defaultValues={editDefaults}
                saving={saving}
                onSave={handleSave}
                onCancel={() => { setShowForm(false); setEditingId(null); }}
              />
            ) : (
              <button
                onClick={handleAdd}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 dark:border-slate-400 rounded-xl text-gray-500 dark:text-gray-400 hover:border-brand-300 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400 transition-colors"
              >
                <Plus className="w-5 h-5" /> 新增收货地址
              </button>
            )}
          </>
        )}
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
