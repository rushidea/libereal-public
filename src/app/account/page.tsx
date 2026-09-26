'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  Package, MapPin, Bell, ChevronRight, User, FileText,
  Check, Truck,
  CheckCheck, Heart, Trash2,
} from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import Breadcrumb from '@/components/Breadcrumb';
import QuickOrderModal from '@/components/QuickOrderModal';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

import SpectrumViewer from '@/components/spectra/SpectrumViewer';
import { useWishlist } from '@/context/WishlistContext';
import { ProtocolsPanel, RecipesPanel } from '@/components/community/Panels';
import OrdersPanel from '@/components/account/OrdersPanel';
import InquiriesPanel from '@/components/account/InquiriesPanel';
import AccountSidebar from '@/components/account/AccountSidebar';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface Order {
  id: string;
  name: string;
  email: string;
  phone: string;
  institution: string;
  department?: string;
  items: unknown[];
  subtotal: number;
  total: number;
  status: string;
  createdAt: string;
  paymentMethod?: string;
  notes?: string;
  userName?: string;
  userInstitution?: string;
  userDepartment?: string;
  userPhone?: string;
  shipments?: Array<{ id: string; method: string; carrier?: string; trackingNumber?: string }>;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  linkUrl?: string;
  metadata?: string;
  createdAt: string;
}

const TIER_CONFIG: Record<string, { label: string; color: string }> = { standard: { label: 'standard', color: 'bg-brand-50 text-brand-700 dark:bg-brand-500/30 dark:text-brand-500' } };

const DASHBOARD_TAB_KEYS = ['overview', 'orders', 'inquiries', 'wishlist', 'protocols', 'recipes', 'notifications', 'addresses', 'spectra'];

export default function AccountPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [userProfile, setUserProfile] = useState({ name: '' });
  const [tier, setTier] = useState('standard');
  const [points, setPoints] = useState(0);

  function getGreeting() {
    const now = new Date();
    const hour = now.getHours();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    if (month === 1 && day === 1) return { icon: '🎆', text: '新年快乐' };
    if (month === 1 && day >= 21 && day <= 27) return { icon: '🧧', text: '春节快乐' };
    if (month === 2 && day === 14) return { icon: '💕', text: '情人节快乐' };
    if (month === 3 && day === 8) return { icon: '🌸', text: '妇女节快乐' };
    if (month === 3 && day === 15) return { icon: '🏮', text: '消费者日快乐' };
    if (month === 4 && day === 1) return { icon: '🤡', text: '愚人节快乐' };
    if (month === 4 && day === 5) return { icon: '🕯️', text: '清明节安康' };
    if (month === 5 && day === 1) return { icon: '🔧', text: '劳动节快乐' };
    if (month === 5 && day === 4) return { icon: '🌱', text: '青年节快乐' };
    if (month === 5 && day === 20) return { icon: '🌹', text: '520快乐' };
    if (month === 6 && day === 1) return { icon: '🎈', text: '儿童节快乐' };
    if (month === 6 && day === 10) return { icon: '🐲', text: '端午节安康' };
    if (month === 6 && day === 18) return { icon: '👨', text: '父亲节快乐' };
    if (month === 7 && day === 1) return { icon: '🏳️', text: '建党节快乐' };
    if (month === 8 && day === 1) return { icon: '🪖', text: '建军节快乐' };
    if (month === 9 && day === 10) return { icon: '📚', text: '教师节快乐' };
    if (month === 9 && day === 28) return { icon: '🌕', text: '中秋节快乐' };
    if (month === 10 && day === 1) return { icon: '🎉', text: '国庆节快乐' };
    if (month === 10 && day === 11) return { icon: '🌻', text: '重阳节安康' };
    if (month === 11 && day === 11) return { icon: '🛒', text: '双十一快乐' };
    if (month === 12 && day === 25) return { icon: '🎄', text: '圣诞节快乐' };
    if (month === 12 && day === 24) return { icon: '🎅', text: '平安夜快乐' };

    if (hour < 6) return { icon: '🌙', text: '夜深了' };
    if (hour < 9) return { icon: '🌅', text: '早上好' };
    if (hour < 12) return { icon: '☀️', text: '上午好' };
    if (hour < 14) return { icon: '🌞', text: '中午好' };
    if (hour < 18) return { icon: '🌤️', text: '下午好' };
    if (hour < 21) return { icon: '🌆', text: '晚上好' };
    return { icon: '🌙', text: '夜深了' };
  }

  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(data => {
      if (data.profile) {
        setUserProfile({ name: data.profile.name || '' });
      }
    });
    fetch('/api/profile/points').then(r => r.json()).then(data => {
      setTier(data.tier || 'standard');
      setPoints(data.points || 0);
    });
  }, []);

  const [userSubTab, setUserSubTab] = useState(
    requestedTab && DASHBOARD_TAB_KEYS.includes(requestedTab) ? requestedTab : 'overview',
  );

  return (
    <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader showQuickOrder={showQuickOrder} onQuickOrderToggle={() => setShowQuickOrder(v => !v)} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 pb-24 sm:px-6 sm:py-8 lg:pb-8">
        <div className="hidden sm:block">
          <Breadcrumb items={[
            { label: '首页', href: '/' },
            { label: '我的账户' }
          ]} />
        </div>
        <div className={`mb-4 rounded-2xl p-4 sm:p-5 ${uiSurfaces.panelStrong}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h1 className={`flex items-center gap-2 whitespace-nowrap text-xl font-semibold ${uiSurfaces.titleText}`}>
                <User className="text-brand-600 dark:text-brand-500" size={22} />
                我的账户
              </h1>
              <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>
                管理订单、地址和积分
              </p>
            </div>
            <p className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium sm:justify-end sm:text-base ${uiSurfaces.mutedText}`}>
              <span>{(() => { const g = getGreeting(); return `${g.icon} ${g.text}`; })()}，{userProfile.name || '用户'}</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TIER_CONFIG[tier]?.color || 'bg-brand-50 text-brand-700 dark:bg-brand-500/30 dark:text-brand-500'}`}>
                {tier} · {points}积分
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <AccountSidebar activeKey={userSubTab} onTabChange={setUserSubTab} />

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-6">
            <UserDashboard activeTab={userSubTab} setActiveTab={setUserSubTab} tier={tier} points={points} />
          </div>
        </div>
      </main>

      <MobileBottomNav />
      <SiteFooter />
      {showQuickOrder && <QuickOrderModal onClose={() => setShowQuickOrder(false)} />}
    </div>
  );
}

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

function UserDashboard({ activeTab, setActiveTab, tier, points }: { activeTab: string; setActiveTab: (tab: string) => void; tier: string; points: number }) {
  const { wishlist } = useWishlist();
  // IME 中文输入跟踪：composition 期间不要 setState（React 18+ 修复了大部分场景，但 Edge + 某些 IME 仍有问题）
  // composingRef 已移除（之前是 IME 处理用的，但简化后不需要）
  const [userProfile, setUserProfile] = useState({ name: '', email: '', tel: '', company: '', identity: '', advisorName: '', advisorPhone: '' });
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAddr, setEditingAddr] = useState<string | null>(null);
  const [formData, setFormData] = useState({ id: '', name: '', phone: '', address: '', institution: '' });

  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(data => {
      if (data.profile) {
        setUserProfile({
          name: data.profile.name || '',
          email: data.profile.email || '',
          tel: data.profile.phone || '',
          company: data.profile.institution || '',
          identity: data.profile.identity || '',
          advisorName: data.profile.advisorName || '',
          advisorPhone: data.profile.advisorPhone || '',
        });
      }
    });
    fetch('/api/addresses').then(r => r.json()).then(data => { if (Array.isArray(data)) setAddresses(data); });
    fetch('/api/my-orders').then(r => r.json()).then(data => setMyOrders(data.orders || []));
  }, []);

  if (activeTab === 'overview') {
    return (
      <>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className={`rounded-2xl p-5 text-center ${uiSurfaces.panel}`}>
            <div className="text-2xl font-bold text-brand-600 dark:text-brand-500">{myOrders.length}</div>
            <div className="text-xs text-gray-400 mt-1 dark:text-gray-500">总订单数</div>
          </div>
          <button onClick={() => setActiveTab('wishlist')} className={`cursor-pointer rounded-2xl p-5 text-center transition-colors hover:bg-white/86 ${uiSurfaces.panel}`}>
            <div className="text-2xl font-bold text-brand-600 dark:text-brand-500">{wishlist.length}</div>
            <div className="text-xs text-gray-400 mt-1 dark:text-gray-500">收藏产品</div>
          </button>
          <div className={`rounded-2xl p-5 text-center ${uiSurfaces.panel}`}>
            <div className="text-2xl font-bold text-brand-600 dark:text-brand-500">{addresses.length}</div>
            <div className="text-xs text-gray-400 mt-1 dark:text-gray-500">收货地址</div>
          </div>
        </div>
        <div className={`rounded-2xl p-6 ${uiSurfaces.panelStrong}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={`font-semibold ${uiSurfaces.titleText}`}>最近订单</h3>
            <button onClick={() => setActiveTab('orders')} className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1 dark:text-brand-500 dark:hover:text-brand-300">
              查看全部 <ChevronRight size={14} />
            </button>
          </div>
          <div className="space-y-3">
            {myOrders.slice(0, 2).map(order => {
              const itemCount = order.items.length;
              return (
              <div key={order.id} className="flex items-center justify-between border-b border-gray-50 py-3 last:border-0 dark:border-slate-300">
                <div>
                  <p className="max-w-[180px] truncate text-sm font-medium text-gray-800 dark:text-slate-800">{order.id}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(order.createdAt).toLocaleDateString('zh-CN')} · {itemCount}件产品</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-800 dark:text-slate-800">¥{order.subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</p>
                  <p className={`text-xs ${order.status === '已完成' ? 'text-green-600' : 'text-amber-600'}`}>{order.status}</p>
                </div>
              </div>
              );
            })}
            {myOrders.length === 0 && <p className="text-sm text-gray-400 text-center py-4 dark:text-gray-500">暂无订单</p>}
          </div>
        </div>
      </>
    );
  }

  if (activeTab === 'orders') {
    return <OrdersPanel />;
  }

  if (activeTab === 'inquiries') {
    return <InquiriesPanel />;
  }

  if (activeTab === 'wishlist') {
    return <WishlistPanel />;
  }

  if (activeTab === 'protocols') {
    return <ProtocolsPanel />;
  }

  if (activeTab === 'recipes') {
    return <RecipesPanel />;
  }

  if (activeTab === 'notifications') {
    return <NotificationsPanel />;
  }

  if (activeTab === 'addresses') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className={`font-semibold ${uiSurfaces.titleText}`}>收货地址</h3>
          <button onClick={() => { setEditingAddr(null); setShowForm(true); setFormData({ id: '', name: '', phone: '', address: '', institution: '' }); }} className="text-sm px-4 py-2 bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 transition-colors dark:bg-brand-100 dark:text-brand-700 dark:hover:bg-brand-200">
            + 添加新地址
          </button>
        </div>
        {showForm && (
          <div className={`rounded-2xl p-6 ${uiSurfaces.panelStrong}`}>
            <h4 className={`mb-4 font-semibold ${uiSurfaces.titleText}`}>{editingAddr ? '编辑地址' : '新增地址'}</h4>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><label className="block text-xs text-gray-500 mb-1 dark:text-slate-500">收货人</label><input value={formData.name} onChange={e => setFormData(f => ({...f, name: e.target.value}))} placeholder="姓名" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 dark:border-slate-300 dark:bg-slate-100/70 dark:text-slate-700 dark:placeholder:text-slate-500" /></div>
              <div><label className="block text-xs text-gray-500 mb-1 dark:text-slate-500">手机</label><input value={formData.phone} onChange={e => setFormData(f => ({...f, phone: e.target.value}))} placeholder="手机号码" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 dark:border-slate-300 dark:bg-slate-100/70 dark:text-slate-700 dark:placeholder:text-slate-500" /></div>
              <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1 dark:text-slate-500">收货地址 <span className="text-red-500 dark:text-red-400">*</span></label><input value={formData.address} onChange={e => setFormData(f => ({...f, address: e.target.value}))} placeholder="详细收货地址" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 dark:border-slate-300 dark:bg-slate-100/70 dark:text-slate-700 dark:placeholder:text-slate-500" /></div>
              <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1 dark:text-slate-500">单位/实验室</label><input value={formData.institution} onChange={e => setFormData(f => ({...f, institution: e.target.value}))} placeholder="单位名称或实验室名称" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 dark:border-slate-300 dark:bg-slate-100/70 dark:text-slate-700 dark:placeholder:text-slate-500" /></div>
            </div>
            <div className="flex gap-3">
              <button onClick={async () => {
                if (!formData.name || !formData.phone || !formData.address) { alert('请填写收货人、手机和收货地址'); return; }
                try {
                  if (editingAddr) {
                    await fetch(`/api/addresses/${editingAddr}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
                  } else {
                    await fetch('/api/addresses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...formData, isDefault: addresses.length === 0 }) });
                  }
                  const updated = await fetch('/api/addresses').then(r => r.json());
                  setAddresses(Array.isArray(updated) ? updated : []);
                  setShowForm(false);
                } catch { alert('保存失败'); }
              }} className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">保存地址</button>
              <button onClick={() => setShowForm(false)} className="px-5 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 dark:border-slate-400 dark:text-gray-600 dark:hover:bg-gray-400/20">取消</button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {addresses.map(addr => (
            <div key={addr.id} className={`relative rounded-2xl p-5 ${uiSurfaces.panel} ${addr.isDefault ? 'border-brand-300' : ''}`}>
              {addr.isDefault === 1 && <span className="absolute top-3 right-3 text-xs px-2 py-0.5 bg-brand-50 text-brand-700 rounded dark:bg-brand-100 dark:text-brand-700">默认</span>}
              <div className="flex items-start gap-3">
                <MapPin size={18} className={`mt-0.5 flex-shrink-0 ${addr.isDefault === 1 ? 'text-brand-500' : 'text-gray-400'}`} />
                <div>
                  <div className="flex items-center gap-2 mb-1"><span className="text-sm font-medium text-gray-800 dark:text-slate-800">{addr.name}</span><span className="text-sm text-gray-500 dark:text-slate-500">{addr.phone}</span></div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{addr.institution && <span>{addr.institution} · </span>}{addr.address}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-3">
                <button onClick={() => { setEditingAddr(addr.id); setFormData({ id: addr.id, name: addr.name, phone: addr.phone, address: addr.address, institution: addr.institution || '' }); setShowForm(true); }} className="text-xs text-gray-400 hover:text-brand-600 dark:text-gray-500 dark:hover:text-brand-500">编辑</button>
                <button onClick={async () => { if (!confirm('确定删除？')) return; await fetch(`/api/addresses/${addr.id}`, { method: 'DELETE' }); const updated = await fetch('/api/addresses').then(r => r.json()); setAddresses(Array.isArray(updated) ? updated : []); }} className="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400">删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'spectra') {
    return <SpectrumViewer />;
  }

  return null;
}

function NotificationsPanel() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  useEffect(() => {
    fetch('/api/notifications').then(r => r.json()).then(data => {
      setNotifications(data.notifications || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function markAsRead(id: string) {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }

  async function markAllAsRead() {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markAll: true }) });
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  }

  const filtered = filter === 'unread' ? notifications.filter(n => !n.isRead) : notifications;
  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl p-4 ${uiSurfaces.panelStrong}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bell className="text-brand-600" size={22} />
            <div>
              <h2 className={`text-lg font-semibold ${uiSurfaces.titleText}`}>消息中心</h2>
              <p className={`text-xs ${uiSurfaces.mutedText}`}>查看您的所有消息</p>
            </div>
          </div>
          {unreadCount > 0 && <button onClick={markAllAsRead} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-500 dark:hover:text-brand-400"><CheckCheck className="w-4 h-4" />全部已读</button>}
        </div>
      </div>

      <div className="flex gap-2">
        {[{ key: 'all', label: '全部', count: notifications.length }, { key: 'unread', label: '未读', count: unreadCount }].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key as 'all' | 'unread')} className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${filter === f.key ? 'bg-brand-500 text-white' : 'border border-gray-200 bg-white/70 text-gray-600 hover:bg-white/86 dark:border-slate-300 dark:bg-slate-100/64 dark:text-slate-600 dark:hover:bg-slate-100/76'}`}>{f.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={`rounded-2xl p-12 text-center ${uiSurfaces.panel}`}>
          <Bell className="w-12 h-12 text-gray-300 dark:text-gray-500 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-500">{filter === 'unread' ? '暂无未读消息' : '暂无消息'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(notif => {
            const cfg = { quote_received: { icon: FileText, color: 'bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-500', label: '报价通知' }, order_created: { icon: Package, color: 'bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-500', label: '订单生成' }, order_status_changed: { icon: Truck, color: 'bg-purple-50 text-purple-600 dark:bg-purple-500/20 dark:text-purple-500', label: '状态更新' }, default: { icon: Bell, color: 'bg-gray-50 text-gray-600 dark:bg-gray-500/20 dark:text-gray-500', label: '通知' } }[notif.type] || { icon: Bell, color: 'bg-gray-50 text-gray-600 dark:bg-gray-500/20 dark:text-gray-500', label: '通知' };
            const Icon = cfg.icon;
            return (
              <div key={notif.id} className={`rounded-2xl transition-all ${uiSurfaces.panel} ${notif.isRead ? 'border-gray-100' : 'border-brand-200 dark:border-brand-200'}`}>
                <div className="p-4 flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.color}`}><Icon className="w-5 h-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm font-bold ${notif.isRead ? 'text-gray-500 dark:text-slate-500' : 'text-gray-900 dark:text-slate-800'}`}>{notif.title}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{cfg.label}</p>
                      </div>
                      {!notif.isRead && <div className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />}
                    </div>
                    <p className={`text-sm mt-1 leading-relaxed ${notif.isRead ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-600'}`}>{notif.content}</p>
                  </div>
                  {!notif.isRead && <button onClick={() => markAsRead(notif.id)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-500 rounded-lg transition-colors flex-shrink-0" title="标记为已读"><Check className="w-4 h-4" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WishlistPanel() {
  const { wishlist, removeFromWishlist, clearWishlist, isSyncing } = useWishlist();
  const [clearing, setClearing] = useState(false);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  const handleClear = async () => {
    if (!confirm('确定要清空所有收藏吗？')) return;
    setClearing(true);
    try {
      await clearWishlist();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl p-4 ${uiSurfaces.panelStrong}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Heart className="text-brand-500" size={22} />
            <div>
              <h2 className={`text-lg font-semibold ${uiSurfaces.titleText}`}>我的收藏</h2>
              <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>
                {isSyncing ? '同步中...' : '收藏产品与后续采购准备'}
              </p>
            </div>
          </div>
          {wishlist.length > 0 && (
            <button
              onClick={handleClear}
              disabled={clearing}
              className="text-xs text-gray-500 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-500 disabled:opacity-50"
            >
              <Trash2 size={14} className="inline mr-1" />清空收藏
            </button>
          )}
        </div>
      </div>

      {wishlist.length === 0 ? (
        <div className={`rounded-2xl p-12 text-center ${uiSurfaces.panel}`}>
          <Heart className="w-12 h-12 text-gray-300 dark:text-gray-500 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-500">暂无收藏产品</p>
          <Link href="/products" className="text-brand-600 hover:text-brand-700 text-sm mt-2 inline-block dark:text-brand-500">
            去逛逛 →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {wishlist.map(item => (
            <div key={item.id} className={`overflow-hidden rounded-2xl transition-shadow hover:shadow-md ${uiSurfaces.panel}`}>
              <Link href={`/products/${item.id}`} className="block">
                <div className="flex h-32 items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300 dark:from-slate-200 dark:to-slate-300">
                  <Package size={36} className="text-gray-300 dark:text-gray-400" />
                </div>
              </Link>
              <div className="p-4">
                <Link href={`/products/${item.id}`} className="block">
                  <p className="mb-1 line-clamp-2 text-sm font-medium text-gray-800 hover:text-brand-600 dark:text-slate-800 dark:hover:text-brand-700">{item.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{item.brand} · {item.catalogNumber}</p>
                </Link>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-brand-600 dark:text-brand-500">
                    {item.displayPrice ? formatPrice(item.displayPrice.salePrice) : (item.promotionalPrice ? formatPrice(item.promotionalPrice) : item.price != null ? formatPrice(item.price) : '待报价')}
                  </span>
                  <button
                    onClick={() => removeFromWishlist(item.id)}
                    className="text-xs text-gray-500 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-500 flex items-center gap-1"
                    title="移除收藏"
                  >
                    <Trash2 size={12} /> 移除
                  </button>
                </div>
                {item.inStock === false && (
                  <p className="text-xs text-orange-600 dark:text-orange-500 mt-2">⚠️ 缺货</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
