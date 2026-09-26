'use client';

import { useState, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BufferSummary } from '@/data/buffers-summary';
import type { BufferDetail } from '@/data/buffers-detail';
import { getBufferIcon } from '@/data/buffers-summary';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface BufferCardProps {
  buffer: BufferSummary;
  isExpanded: boolean;
  isHeaderOnly?: boolean;
  isLoading: boolean;
  detailData: BufferDetail | null;
  onToggle: (id: string) => void;
}

function scaleAmount(baseAmount: string, multiplier: number): string {
  const match = baseAmount.match(/^([\d.]+)\s*(.+)$/);
  if (match) {
    const value = parseFloat(match[1]) * multiplier;
    if (Number.isInteger(value)) {
      return `${value} ${match[2]}`;
    }
    return `${value.toFixed(2)} ${match[2]}`;
  }
  return baseAmount;
}

export default function BufferCard({
  buffer,
  isExpanded,
  isHeaderOnly = false,
  isLoading,
  detailData,
  onToggle,
}: BufferCardProps) {
  const [concentrationMultiplier, setConcentrationMultiplier] = useState(1);
  const Icon = useMemo(() => getBufferIcon(buffer.icon), [buffer.icon]);

  const hasConcentrationSelector = detailData?.concentrationMultipliers && detailData.concentrationMultipliers.length > 0;

  return (
    <div
      className={`rounded-brand overflow-hidden transition-all duration-300 ${uiSurfaces.focusRing} ${
          isExpanded && !isHeaderOnly
          ? 'bg-[var(--brand-color-success-bg)] border-2 border-[var(--brand-color-success)] shadow-[var(--shadow-panel)]'
          : `${uiSurfaces.panel} border-[var(--surface-border)] hover:border-[var(--brand-color-primary)] hover:shadow-[var(--shadow-panel)]`
      }`}
    >
      <div
        className="p-4 cursor-pointer"
        onClick={() => onToggle(buffer.id)}
      >
        <div className={`flex items-start gap-3 ${isExpanded && !isHeaderOnly ? 'justify-center' : ''}`}>
          {!(isExpanded && !isHeaderOnly) && (
            <div className={`p-2.5 rounded-lg ${buffer.bgColor}`}>
              {/* eslint-disable-next-line react-hooks/static-components */}
              <Icon className={`w-5 h-5 ${buffer.iconColor}`} />
            </div>
          )}
          <div className={`flex-1 min-w-0 ${isExpanded && !isHeaderOnly ? 'text-center' : ''}`}>
            <div className={`flex items-center ${isExpanded && !isHeaderOnly ? 'justify-center' : 'justify-between'}`}>
              <h3 className={`font-semibold ${uiSurfaces.titleText} line-clamp-1 ${isExpanded && !isHeaderOnly ? 'text-center' : ''}`}>
                {buffer.name}
              </h3>
              {!(isExpanded && !isHeaderOnly) && (
                <ChevronDown
                  className={`w-4 h-4 ${uiSurfaces.mutedText} flex-shrink-0 ml-2 transition-transform duration-300 ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                />
              )}
            </div>
            <div className={`flex items-center gap-2 mt-1.5 ${isExpanded && !isHeaderOnly ? 'justify-center' : ''}`}>
              {isExpanded && !isHeaderOnly ? (
                <>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium">
                    {buffer.category}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium">
                    {buffer.category}
                  </span>
                </>
              )}
            </div>
            {!(isExpanded && !isHeaderOnly) && (
              <p className={`mt-1.5 line-clamp-2 text-sm ${uiSurfaces.mutedText}`}>{buffer.description}</p>
            )}
          </div>
        </div>
      </div>

      {isExpanded && !isHeaderOnly && (
        <div className="px-4 pb-4">
          {isLoading ? (
            <div className="py-4 space-y-3">
              <div className="animate-pulse space-y-2">
                <div className={`h-4 w-3/4 rounded-brand ${uiSurfaces.skeleton}`} />
                <div className={`h-4 w-1/2 rounded-brand ${uiSurfaces.skeleton}`} />
              </div>
            </div>
          ) : detailData ? (
            <div className="py-4 space-y-4">
              {/* 浓度选择器 */}
              {hasConcentrationSelector && (
                <div className={`${uiSurfaces.panelStrong} rounded-brand p-3`}>
                  <div className="flex items-center justify-between mb-2">
                  <h4 className={`text-sm font-semibold ${uiSurfaces.text}`}>浓度档位</h4>
                    <span className="text-xs text-purple-600 font-medium">
                      当前: {concentrationMultiplier}×
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detailData.concentrationMultipliers?.map((mult) => (
                      <button
                        key={mult}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConcentrationMultiplier(mult);
                        }}
                        className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                          concentrationMultiplier === mult
                            ? 'bg-purple-500 text-white border-purple-500'
                            : 'bg-white text-purple-600 border-purple-200 hover:bg-purple-100'
                        }`}
                      >
                        {mult}×
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 配方成分 */}
              <div>
                <h4 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${uiSurfaces.text}`}>
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-xs font-bold flex items-center justify-center">1</span>
                  配方成分 {concentrationMultiplier !== 1 && <span className="text-xs text-purple-600">(已按 {concentrationMultiplier}× 缩放)</span>}
                </h4>
                <table className="w-full">
                  <tbody>
                    {detailData.components.map((comp, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className={`py-1.5 text-sm ${uiSurfaces.text}`}>{comp.name}</td>
                        <td className={`py-1.5 text-right font-mono text-sm ${uiSurfaces.textSecondary}`}>
                          {concentrationMultiplier !== 1
                            ? scaleAmount(comp.amount, concentrationMultiplier)
                            : comp.amount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 配制步骤 */}
              <div>
                <h4 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${uiSurfaces.text}`}>
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-xs font-bold flex items-center justify-center">2</span>
                  配制步骤
                </h4>
                <ol className="space-y-2">
                  {detailData.preparation.map((step, idx) => (
                    <li key={idx} className="flex gap-2 text-sm">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className={`${uiSurfaces.textSecondary} leading-relaxed`}>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {detailData.storage && (
                <div className={`${uiSurfaces.panelStrong} rounded-brand p-3`}>
                  <h4 className={`mb-1 text-sm font-semibold ${uiSurfaces.text}`}>保存条件</h4>
                  <p className={`text-sm ${uiSurfaces.textSecondary}`}>{detailData.storage}</p>
                </div>
              )}
              {detailData.notes && detailData.notes.length > 0 && (
                <div>
                  <h4 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${uiSurfaces.text}`}>
                    <span className="text-amber-500">💡</span>
                    注意事项
                  </h4>
                  <ul className="space-y-1.5">
                    {detailData.notes.map((note, idx) => (
                      <li key={idx} className={`flex gap-2 text-xs ${uiSurfaces.textSecondary}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-2" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
