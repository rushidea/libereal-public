import LegalDocumentsManager from '@/components/admin/LegalDocumentsManager';
import { Scale } from 'lucide-react';

export default function AdminLegalPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Scale className="w-6 h-6 text-brand-600" />
          文书管理
        </h1>
        <p className="text-sm text-gray-500 mt-1">配置律师审定商事文书的发布范围与用户同意要求。</p>
      </div>
      <LegalDocumentsManager />
    </div>
  );
}
