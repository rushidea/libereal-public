'use client';

import { Package } from 'lucide-react';
import PointsManager from '@/components/admin/PointsManager';

export default function PointsProductsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Package className="w-5 h-5 text-brand-600" /> 积分商品
        </h1>
        <p className="text-sm text-gray-500 mt-1">管理积分商城礼遇（名称/分类/积分/库存/规格）</p>
      </div>
      <PointsManager defaultTab="products" />
    </div>
  );
}
