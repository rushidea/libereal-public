import { Megaphone } from 'lucide-react';
import AdminNotificationsManager from '@/components/admin/AdminNotificationsManager';

export default function AdminNotificationsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 sm:text-2xl">
          <Megaphone className="h-6 w-6 text-brand-600" />
          消息管理
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          发布公共通知、查看与删除站内消息。强制确认类通知会在客户未确认前遮罩全站。
        </p>
      </div>
      <AdminNotificationsManager />
    </div>
  );
}
