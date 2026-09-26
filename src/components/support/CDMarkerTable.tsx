'use client';

import { useState, useMemo } from 'react';
import { CD_MARKERS, CD_MARKER_CELL_TYPES, type CellType } from '@/data/cd-markers';
import { uiSurfaces } from '@/lib/ui-surfaces';

type ExprStyle = {
  bg: string;
  title: string;
};

const EXPR_STYLES: Record<string, ExprStyle> = {
  S: { bg: 'bg-emerald-600', title: 'Strong' },
  p: { bg: 'bg-emerald-400', title: 'Positive' },
  Low: { bg: 'bg-emerald-200 dark:bg-emerald-800', title: 'Low' },
  Act: { bg: 'bg-amber-500', title: 'Activated' },
  'S / Act': { bg: 'bg-amber-600', title: 'Strong / Activated' },
  'S / Low': { bg: 'bg-emerald-300 dark:bg-emerald-700', title: 'Strong / Low' },
  Folli: { bg: 'bg-sky-400', title: 'Follicular' },
  Tons: { bg: 'bg-violet-400', title: 'Tonsil' },
  Intest: { bg: 'bg-teal-400', title: 'Intestine' },
  Plasm: { bg: 'bg-pink-400', title: 'Plasma' },
  n: { bg: 'bg-gray-300 dark:bg-slate-600', title: 'Negative' },
};

function ExprDot({ value }: { value: string }) {
  if (!value) {
    return <span className={uiSurfaces.textQuaternary}>-</span>;
  }
  const style = EXPR_STYLES[value];
  if (!style) {
    return <span className={`text-xs ${uiSurfaces.textSecondary}`}>{value}</span>;
  }
  return (
    <div className="flex items-center justify-center" title={`${style.title} (${value})`}>
      <span className={`inline-block h-3 w-3 rounded-full ${style.bg}`} />
    </div>
  );
}

type CDMarkerTableProps = {
  searchQuery: string;
};

export default function CDMarkerTable({ searchQuery }: CDMarkerTableProps) {
  const [filterCellType, setFilterCellType] = useState<CellType | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return CD_MARKERS.filter((m) => {
      const matchSearch =
        !q ||
        m.id.toLowerCase().includes(q) ||
        m.aliases.toLowerCase().includes(q);
      const matchFilter =
        !filterCellType ||
        (m.expr[filterCellType] !== '' && m.expr[filterCellType] !== 'n');
      return matchSearch && matchFilter;
    });
  }, [searchQuery, filterCellType]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilterCellType(null)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            filterCellType === null
              ? 'bg-brand-600 text-[var(--brand-color-text-on-primary)] shadow-sm shadow-brand-600/20'
              : `${uiSurfaces.panel} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--surface-hover)]`
          }`}
        >
          全部
        </button>
        {CD_MARKER_CELL_TYPES.map((ct) => (
          <button
            key={ct.key}
            onClick={() =>
              setFilterCellType(filterCellType === ct.key ? null : ct.key)
            }
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              filterCellType === ct.key
                ? 'bg-brand-600 text-[var(--brand-color-text-on-primary)] shadow-sm shadow-brand-600/20'
                : `${uiSurfaces.panel} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--surface-hover)]`
            }`}
          >
            {ct.label}
          </button>
        ))}
      </div>

      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs ${uiSurfaces.textSecondary}`}>
        {Object.entries(EXPR_STYLES).map(([key, style]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${style.bg}`}
            />
            <span>{style.title}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className={uiSurfaces.textQuaternary}>-</span>
          <span>ND</span>
        </div>
      </div>

      <div
        className={`overflow-x-auto rounded-2xl ${uiSurfaces.panel} overflow-hidden`}
      >
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-[var(--surface-border)]">
              <th className={`sticky left-0 z-10 bg-[var(--surface-input)] px-3 py-2.5 text-left font-semibold backdrop-blur-sm ${uiSurfaces.titleText}`}>
                CD
              </th>
              <th className={`px-3 py-2.5 text-left font-semibold ${uiSurfaces.titleText}`}>
                Alternative Name
              </th>
              {CD_MARKER_CELL_TYPES.map((ct) => (
                <th
                  key={ct.key}
                  className={`px-2 py-2.5 text-center font-semibold ${uiSurfaces.titleText}`}
                  title={ct.label}
                >
                  {ct.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={13}
                  className={`px-3 py-12 text-center ${uiSurfaces.textQuaternary}`}
                >
                  未找到匹配的 CD 标记
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[var(--surface-border)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <td className={`sticky left-0 z-10 bg-[var(--surface-input)] px-3 py-2 font-semibold backdrop-blur-sm ${uiSurfaces.textInteractive}`}>
                    {m.id}
                  </td>
                  <td className={`max-w-[260px] truncate px-3 py-2 ${uiSurfaces.textSecondary}`}>
                    {m.aliases || '-'}
                  </td>
                  {CD_MARKER_CELL_TYPES.map((ct) => (
                    <td key={ct.key} className="px-2 py-2 text-center">
                      <ExprDot value={m.expr[ct.key]} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className={`text-xs ${uiSurfaces.textQuaternary}`}>
        共 {filtered.length} 个标记
      </p>
    </div>
  );
}
