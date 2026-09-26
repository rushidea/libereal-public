'use client';

import { Tag } from 'lucide-react';
import DiscountTemplateManager from '@/components/admin/DiscountTemplateManager';

export default function AdminDiscountsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Tag className="w-6 h-6 text-brand-600" /> 折扣模板
        </h1>
        <p className="text-sm text-gray-500 mt-1">创建和管理折扣模板（统一折扣率 + 品牌差异化）</p>
      </div>

      <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/70 p-4 text-sm text-gray-600">
        <p>
          <span className="font-medium text-gray-800">使用流程：</span>
          1) 在下方创建/编辑模板；
          2) 切到 <a href="/admin/discounts/apply" className="text-indigo-600 hover:underline font-medium">批量应用</a> 页，从筛选列表中选用户 + 选模板一键套用。
        </p>
      </div>

      <DiscountTemplateManager />
    </div>
  );
}
