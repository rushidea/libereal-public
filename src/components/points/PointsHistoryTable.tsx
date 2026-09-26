'use client';

import { POINTS_LOG_TYPE_LABELS, POINTS_LOG_TYPE_COLORS, PointsLogType, formatPoints } from '@/lib/points';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface PointsLog {
  id: string;
  delta: number;
  type: string;
  reason: string | null;
  adminEmail: string | null;
  createdAt: string;
}

export default function PointsHistoryTable({ logs }: { logs: PointsLog[] }) {
  if (logs.length === 0) {
    return (
      <div className={`${uiSurfaces.panel} rounded-brand border-[var(--surface-border)] p-12 text-center`}>
        <p className={uiSurfaces.mutedText}>暂无积分记录</p>
      </div>
    );
  }

  return (
    <div className={`${uiSurfaces.panel} rounded-brand border-[var(--surface-border)] overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={uiSurfaces.toolbar}>
            <tr className="border-b border-[var(--surface-border)]">
              <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.text}`}>时间</th>
              <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.text}`}>类型</th>
              <th className={`px-4 py-3 text-right font-semibold ${uiSurfaces.text}`}>变动</th>
              <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.text}`}>说明</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="border-b border-[var(--surface-border)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className={`whitespace-nowrap px-4 py-3 text-xs ${uiSurfaces.textSecondary}`}>
                  {new Date(log.createdAt).toLocaleString('zh-CN')}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${POINTS_LOG_TYPE_COLORS[log.type as PointsLogType] || 'bg-gray-100 text-gray-700'}`}>
                    {POINTS_LOG_TYPE_LABELS[log.type as PointsLogType] || log.type}
                  </span>
                </td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${log.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {log.delta > 0 ? '+' : ''}{formatPoints(log.delta)}
                </td>
                <td className={`px-4 py-3 text-xs ${uiSurfaces.textSecondary}`}>{log.reason || (log.adminEmail ? `by ${log.adminEmail}` : '-')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
