'use client';

import { FileText } from 'lucide-react';
import PointsManager from '@/components/admin/PointsManager';

export default function PointsLogsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-brand-600" /> 积分日志
        </h1>
        <p className="text-sm text-gray-500 mt-1">查看所有积分变动记录，支持撤销管理员调整</p>
      </div>
      <PointsManager defaultTab="logs" />
    </div>
  );
}
