'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Tag } from 'lucide-react';
import BulkApplyTemplateModal, { type BulkApplyUser } from '@/components/admin/BulkApplyTemplateModal';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';

type Props = {
  selectedUsers: BulkApplyUser[];
  onApplied: () => void;
};

export default function UserDiscountTemplateSection({ selectedUsers, onApplied }: Props) {
  const [applyOpen, setApplyOpen] = useState(false);
  const selectedCount = selectedUsers.length;
  const canApply = selectedCount > 0;

  return (
    <section className={`mt-8 min-w-0 space-y-4 p-4 sm:p-5 ${adminSurfaceClasses.panel}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Tag className="w-5 h-5 text-indigo-600" />
            折扣模板
          </h2>
          <p className="mt-1 break-words text-sm text-gray-600">
            为上方列表中勾选的用户指定并套用折扣模板。模板的新建与编辑请前往折扣模板管理页。
          </p>
        </div>
        <Link
          href="/admin/discounts"
          className="text-sm text-indigo-700 hover:text-indigo-900 hover:underline shrink-0"
        >
          管理折扣模板
        </Link>
      </div>

      <div className={`flex flex-wrap items-center gap-3 rounded-brand border ${adminSurfaceClasses.border} ${adminSurfaceClasses.panelStrong} px-4 py-3`}>
        <p className="text-sm text-gray-700">
          {canApply
            ? `已选择 ${selectedCount} 个用户`
            : '请先在上方用户列表勾选用户'}
        </p>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => setApplyOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          <Tag className="w-4 h-4" />
          套用折扣模板
        </button>
      </div>

      {applyOpen && (
        <BulkApplyTemplateModal
          selectedUsers={selectedUsers}
          onClose={() => setApplyOpen(false)}
          onDone={() => {
            setApplyOpen(false);
            onApplied();
          }}
        />
      )}
    </section>
  );
}
