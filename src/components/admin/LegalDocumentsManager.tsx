'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';

type AdminLegalDoc = {
  id: string;
  title: string;
  category: string;
  kind: string;
  fileName: string | null;
  sitePath: string | null;
  description: string | null;
  published: boolean;
  requireRegister: boolean;
  requireCheckout: boolean;
  showOnLegalPage: boolean;
  showOnOpenPlatform: boolean;
  sortOrder: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  site: '站内政策',
  index: '索引',
  contract: '合同',
  attachment: '附件',
  sop: '内部流程',
};

async function readJsonResponse(res: Response): Promise<{ documents?: AdminLegalDoc[]; document?: AdminLegalDoc; error?: string }> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as { documents?: AdminLegalDoc[]; document?: AdminLegalDoc; error?: string };
  } catch {
    return { error: text.slice(0, 120) };
  }
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      {label}
    </label>
  );
}

export default function LegalDocumentsManager() {
  const [documents, setDocuments] = useState<AdminLegalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/legal-documents');
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.error || '加载失败');
      setDocuments(data.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请确认数据库迁移已执行。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchDoc = async (id: string, patch: Partial<AdminLegalDoc>) => {
    setSavingId(id);
    setError('');
    try {
      const res = await fetch('/api/admin/legal-documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.error || '保存失败');
      if (data.document) {
        setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...data.document } : d)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请确认数据库迁移已执行。');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          管理律师审定文书在站内的发布、下载与注册/下单必同意项。PDF 源文件位于 <code className="text-xs">docs/legal/</code>。
        </p>
        <button
          type="button"
          onClick={load}
          className={`inline-flex items-center gap-1.5 rounded-brand border px-3 py-2 text-sm ${adminSurfaceClasses.button}`}
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className={`overflow-x-auto ${adminSurfaceClasses.panel} shadow-[var(--shadow-panel)]`}>
        <table className="min-w-[880px] w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs text-gray-500">
              <th className="px-3 py-2.5 font-medium">文书</th>
              <th className="px-3 py-2.5 font-medium">类型</th>
              <th className="px-3 py-2.5 font-medium">发布</th>
              <th className="px-3 py-2.5 font-medium">注册必同意</th>
              <th className="px-3 py-2.5 font-medium">下单必同意</th>
              <th className="px-3 py-2.5 font-medium">法律页</th>
              <th className="px-3 py-2.5 font-medium">开放平台</th>
              <th className="px-3 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-b border-gray-50 align-top hover:bg-gray-50/50">
                <td className="px-3 py-3">
                  <p className="font-medium text-gray-900">{doc.title}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{doc.id}</p>
                  {doc.description ? <p className="mt-1 text-xs text-gray-500 line-clamp-2">{doc.description}</p> : null}
                </td>
                <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">
                  {CATEGORY_LABELS[doc.category] ?? doc.category}
                  <br />
                  <span className="text-gray-400">{doc.kind === 'site' ? doc.sitePath : doc.fileName}</span>
                </td>
                <td className="px-3 py-3">
                  <Toggle checked={doc.published} onChange={(v) => patchDoc(doc.id, { published: v })} label="已发布" />
                </td>
                <td className="px-3 py-3">
                  <Toggle
                    checked={doc.requireRegister}
                    onChange={(v) => patchDoc(doc.id, { requireRegister: v })}
                    label="注册"
                  />
                </td>
                <td className="px-3 py-3">
                  <Toggle
                    checked={doc.requireCheckout}
                    onChange={(v) => patchDoc(doc.id, { requireCheckout: v })}
                    label="下单"
                  />
                </td>
                <td className="px-3 py-3">
                  <Toggle
                    checked={doc.showOnLegalPage}
                    onChange={(v) => patchDoc(doc.id, { showOnLegalPage: v })}
                    label="展示"
                  />
                </td>
                <td className="px-3 py-3">
                  <Toggle
                    checked={doc.showOnOpenPlatform}
                    onChange={(v) => patchDoc(doc.id, { showOnOpenPlatform: v })}
                    label="展示"
                  />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {doc.kind === 'pdf' ? (
                    <a
                      href={`/api/legal/documents/${encodeURIComponent(doc.id)}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      PDF
                    </a>
                  ) : doc.sitePath ? (
                    <a href={doc.sitePath} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
                      查看页面
                    </a>
                  ) : null}
                  {savingId === doc.id ? <p className="mt-1 text-xs text-gray-400">保存中...</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
