'use client';

import { ShoppingCart } from 'lucide-react';
import PointsManager from '@/components/admin/PointsManager';

export default function PointsRedemptionsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-brand-600" /> 兑换订单
        </h1>
        <p className="text-sm text-gray-500 mt-1">处理用户积分兑换申请（待处理→已发货→已完成/已取消）</p>
      </div>
      <PointsManager defaultTab="redemptions" />
    </div>
  );
}
