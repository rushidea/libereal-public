'use client';

import { Plus } from 'lucide-react';
import PointsManager from '@/components/admin/PointsManager';

export default function PointsInjectPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Plus className="w-5 h-5 text-brand-600" /> 积分注入
        </h1>
        <p className="text-sm text-gray-500 mt-1">向个人或课题组注入积分</p>
      </div>
      <PointsManager defaultTab="inject" />
    </div>
  );
}
