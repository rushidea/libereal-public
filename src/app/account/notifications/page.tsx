'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck, Package, FileText, Truck, ExternalLink } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

import Breadcrumb from '@/components/Breadcrumb';

type Notification = {
  id: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  linkUrl?: string;
  metadata?: string;
  createdAt: string;
  scope?: string;
  requiresAck?: boolean;
  acknowledgedAt?: string | null;
};

const TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  'quote_received': { icon: FileText, color: 'bg-brand-50 text-brand-600', label: '报价通知' },
  'order_created': { icon: Package, color: 'bg-blue-50 text-blue-600', label: '订单生成' },
  'order_status_changed': { icon: Truck, color: 'bg-purple-50 text-purple-600', label: '状态更新' },
  'shipping_notification': { icon: Truck, color: 'bg-amber-50 text-amber-600', label: '物流通知' },
  'inquiry_received': { icon: Bell, color: 'bg-amber-50 text-amber-600', label: '新询价' },
  'public_announcement': { icon: Bell, color: 'bg-emerald-50 text-emerald-700', label: '公共通知' },
  'default': { icon: Bell, color: 'bg-gray-50 text-gray-600', label: '通知' },
};

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}

export default function NotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/account/notifications');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchNotifications();
    }
  }, [status]);

  async function fetchNotifications() {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function markAsRead(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, isRead: true } : n)
    );
  }

  async function markAllAsRead() {
    setMarking(true);
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } finally {
      setMarking(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!session) return null;

  const filtered = filter === 'unread'
    ? notifications.filter(n => !n.isRead)
    : notifications;
  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 pb-8">
        <Breadcrumb items={[
          { label: '首页', href: '/' },
          { label: '我的账户', href: '/account' },
          { label: '消息中心' }
        ]} />

        <div className="mb-4 bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Bell className="text-brand-600" size={22} />
              <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">消息中心</h1>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">查看您的所有消息</p>
              </div>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                disabled={marking}
                className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-500 dark:hover:text-brand-400 disabled:opacity-50"
              >
                <CheckCheck className="w-4 h-4" />
                全部已读
              </button>
            )}
          </div>
        </div>
        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {[
            { key: 'all', label: '全部', count: notifications.length },
            { key: 'unread', label: '未读', count: unreadCount },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as 'all' | 'unread')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
 filter === f.key
 ? 'bg-brand-500 text-white'
 : 'bg-white dark:bg-slate-200/65 text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-400/20 border border-gray-200 dark:border-slate-400'
 }`}
            >
              {f.label}
              {f.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${filter === f.key ? 'bg-brand-400 text-white' : 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400'}`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Notification list */}
        {filtered.length === 0 ? (
          <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm p-12 text-center">
            <Bell className="w-12 h-12 text-gray-300 dark:text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-500">{filter === 'unread' ? '暂无未读消息' : '暂无消息'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(notif => {
              const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG['default'];
              const Icon = cfg.icon;

              return (
                <div
                  key={notif.id}
                  className={`bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border transition-all hover:shadow-md ${
 notif.isRead ? 'border-gray-100 dark:border-slate-400' : 'border-brand-200 dark:border-brand-500/40'
 }`}
                >
                  <div className="p-4 flex items-start gap-3">
                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`text-sm font-bold ${notif.isRead ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-slate-900'}`}>
                            {notif.title}
                            {notif.requiresAck ? (
                              <span className="ml-2 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 align-middle">
                                {notif.acknowledgedAt ? '已确认' : '需确认'}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{cfg.label} · {formatTime(notif.createdAt)}</p>
                        </div>
                        {!notif.isRead && (
                          <div className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />
                        )}
                      </div>
                      <p className={`text-sm mt-1 leading-relaxed ${notif.isRead ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-500'}`}>
                        {notif.content}
                      </p>
                      {notif.linkUrl && (
                        <Link
                          href={notif.linkUrl}
                          className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-500 dark:hover:text-brand-400 mt-2 font-medium"
                        >
                          查看详情 <ExternalLink className="w-3 h-3" />
                        </Link>
                      )}
                    </div>

                    {/* Mark as read button */}
                    {!notif.isRead && (
                      <button
                        onClick={() => markAsRead(notif.id)}
                        className="p-1.5 text-gray-400 hover:text-brand-600 dark:hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/20 rounded-lg transition-colors flex-shrink-0"
                        title="标记为已读"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
