'use client';

import { use } from 'react';
import { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MapPin, Edit2, Star, Trash2, CheckCircle } from 'lucide-react';

import QuickOrderModal from '@/components/QuickOrderModal';

import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import AdaptiveHeader from '@/components/AdaptiveHeader';

type Address = {
  id: string;
  name: string;
  phone: string;
  address: string;
  institution: string | null;
  label: string | null;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
};

export default function AddressDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const [address, setAddress] = useState<Address | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '', institution: '' });
  const [error, setError] = useState('');
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [role, setRole] = useState('customer');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [unreadCount, setUnreadCount] = useState(0);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/account/addresses');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !id) return;
    fetch(`/api/addresses/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          router.replace('/account/addresses');
          return;
        }
        setAddress(data);
        setForm({
          name: data.name || '',
          phone: data.phone || '',
          address: data.address || '',
          institution: data.institution || '',
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status, id, router]);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/auth/role')
      .then(r => r.json())
      .then(data => setRole(data.role ?? 'customer'))
      .catch(() => setRole('customer'));
    fetch('/api/notifications')
      .then(r => r.json())
      .then(data => {
        const notifs = data.notifications || [];
        const unread = notifs.filter((n: { isRead: boolean }) => !n.isRead);
        setUnreadCount(unread.length);
      })
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (showUserMenu && userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (showNotifMenu && notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showUserMenu, showNotifMenu]);

  const handleSave = async () => {
    if (!form.name || !form.phone || !form.address) {
      setError('请填写收货人、手机和收货地址');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`/api/addresses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const updated = await res.json();
        setAddress(updated);
        setShowEdit(false);
      } else {
        setError('更新失败');
      }
    } catch {
      setError('更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async () => {
    await fetch(`/api/addresses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: 1 }),
    });
    setAddress(prev => prev ? { ...prev, isDefault: 1 } : null);
  };

  const handleDelete = async () => {
    if (!confirm('确定删除该收货地址？')) return;
    await fetch(`/api/addresses/${id}`, { method: 'DELETE' });
    router.replace('/account/addresses');
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">地址不存在</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />

      <div className="bg-white/65 dark:bg-slate-200/65 backdrop-blur-xl border-b border-gray-100 dark:border-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
          <nav className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Link href="/" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">首页</Link>
            <span className="text-gray-300 dark:text-gray-600">/</span>
            <Link href="/account" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">我的账户</Link>
            <span className="text-gray-300 dark:text-gray-600">/</span>
            <span className="text-gray-700 dark:text-gray-300 font-medium">收货地址</span>
          </nav>
        </div>
      </div>

      {showQuickOrder && (
        <QuickOrderModal onClose={() => setShowQuickOrder(false)} />
      )}

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/account/addresses" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50">
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">收货地址</h1>
            <p className="text-xs font-mono text-gray-400">{address.id}</p>
          </div>
          {address.isDefault === 1 && (
            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-brand-50 dark:bg-brand-500/20 text-brand-700 dark:text-brand-500">
              <CheckCircle size={14} /> 默认地址
            </span>
          )}
        </div>

        <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-5">
          <div className="flex items-start gap-4 mb-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${address.isDefault ? 'bg-brand-100 dark:bg-brand-500/30 text-brand-600 dark:text-brand-500' : 'bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500'}`}>
              <MapPin className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-gray-900 dark:text-slate-900 text-lg">{address.name}</span>
                <span className="text-gray-500 dark:text-gray-400">{address.phone}</span>
              </div>
              <p className="text-gray-600 dark:text-gray-500">
                {address.institution && <span className="text-gray-500 dark:text-gray-400">{address.institution} · </span>}
                {address.address}
              </p>
            </div>
          </div>

          {!showEdit ? (
            <div className="flex flex-wrap gap-3">
              {address.isDefault !== 1 && (
                <button
                  onClick={handleSetDefault}
                  className="flex-1 py-2.5 rounded-lg border border-gray-200 dark:border-slate-400 text-gray-600 dark:text-gray-600 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-400/20 flex items-center justify-center gap-2"
                >
                  <Star className="w-4 h-4" /> 设为默认
                </button>
              )}
              <button
                onClick={() => setShowEdit(true)}
                className="flex-1 py-2.5 rounded-lg border border-brand-200 dark:border-brand-500/50 text-brand-700 dark:text-brand-600 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-500/20 flex items-center justify-center gap-2"
              >
                <Edit2 className="w-4 h-4" /> 编辑
              </button>
              <button
                onClick={handleDelete}
                className="py-2.5 px-4 rounded-lg border border-red-200 dark:border-red-500/50 text-red-600 dark:text-red-500 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-500/20 flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> 删除
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/40 rounded-xl text-red-600 dark:text-red-500 text-sm">{error}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">收货人 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-400 rounded-lg text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">手机 <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-400 rounded-lg text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">单位/实验室</label>
                <input
                  type="text"
                  value={form.institution}
                  onChange={e => setForm(f => ({ ...f, institution: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-400 rounded-lg text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">收货地址 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-400 rounded-lg text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEdit(false)}
                  className="flex-1 py-2.5 rounded-lg border border-gray-200 dark:border-slate-400 text-gray-600 dark:text-gray-600 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-400/20"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
