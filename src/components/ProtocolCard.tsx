'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ChevronDown, CheckCircle, AlertTriangle, Heart, Package } from 'lucide-react';
import type { ProtocolSummary } from '@/data/protocols-summary';
import type { Protocol } from '@/data/protocols-detail';
import { getIcon } from '@/data/protocols-summary';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface ProtocolCardProps {
  protocol: ProtocolSummary;
  isExpanded: boolean;
  isHeaderOnly?: boolean;
  isLoading: boolean;
  detailData: Protocol | null;
  onToggle: (id: string) => void;
}

const difficultyColors: Record<string, string> = {
  '基础': uiSurfaces.badgeSuccess,
  '中级': uiSurfaces.badgeWarning,
  '高级': uiSurfaces.badgeError,
};

export default function ProtocolCard({
  protocol,
  isExpanded,
  isHeaderOnly = false,
  isLoading,
  detailData,
  onToggle,
}: ProtocolCardProps) {
  const Icon = useMemo(() => getIcon(protocol.icon), [protocol.icon]);

  return (
    <div
      className={`overflow-hidden rounded-[var(--brand-border-radius-lg)] transition-all duration-300 ${
        isExpanded && !isHeaderOnly
          ? `${uiSurfaces.panelStrong} border-2 border-[var(--brand-color-primary-border-hover)] bg-[var(--brand-color-primary-bg)] shadow-[var(--shadow-panel-strong)]`
          : `${uiSurfaces.panel} hover:border-[var(--brand-color-primary-border-hover)] hover:shadow-[var(--shadow-panel-strong)]`
      }`}
    >
      <div
        className="p-4 cursor-pointer"
        onClick={() => onToggle(protocol.id)}
      >
        <div className={`flex items-start gap-3 ${isExpanded && !isHeaderOnly ? 'justify-center' : ''}`}>
          {!(isExpanded && !isHeaderOnly) && (
            <div className={`rounded-[var(--brand-border-radius)] p-2.5 ${protocol.bgColor}`}>
              {/* eslint-disable-next-line react-hooks/static-components */}
              <Icon className={`w-5 h-5 ${protocol.iconColor}`} />
            </div>
          )}
          <div className={`flex-1 min-w-0 ${isExpanded && !isHeaderOnly ? 'text-center' : ''}`}>
            <div className={`flex items-center ${isExpanded && !isHeaderOnly ? 'justify-center' : 'justify-between'}`}>
              <h3 className={`line-clamp-1 font-semibold ${uiSurfaces.titleText} ${isExpanded && !isHeaderOnly ? 'text-center' : ''}`}>
                {protocol.title}
              </h3>
              {!(isExpanded && !isHeaderOnly) && (
                <ChevronDown
                  className={`ml-2 h-4 w-4 flex-shrink-0 transition-transform duration-300 ${uiSurfaces.textQuaternary} ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                />
              )}
            </div>
            <div className={`flex items-center gap-2 mt-1.5 ${isExpanded && !isHeaderOnly ? 'justify-center' : ''}`}>
              {isExpanded && !isHeaderOnly ? (
                <>
                  <span className={`${difficultyColors[protocol.difficulty] ?? uiSurfaces.badge} min-h-0 px-2 py-0.5 text-xs font-medium`}>
                    {protocol.difficulty}
                  </span>
                  <span className={`text-xs ${uiSurfaces.textQuaternary}`}>{protocol.category}</span>
                  <span className={`text-xs ${uiSurfaces.textQuaternary}`}>·</span>
                  <span className={`text-xs ${uiSurfaces.textQuaternary}`}>{protocol.duration}</span>
                </>
              ) : (
                <>
                  <span className={`${difficultyColors[protocol.difficulty] ?? uiSurfaces.badge} min-h-0 px-2 py-0.5 text-xs font-medium`}>
                    {protocol.difficulty}
                  </span>
                  <span className={`text-xs ${uiSurfaces.textQuaternary}`}>{protocol.category}</span>
                  <span className={`text-xs ${uiSurfaces.textQuaternary}`}>·</span>
                  <span className={`text-xs ${uiSurfaces.textQuaternary}`}>{protocol.duration}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {isExpanded && !isHeaderOnly && (
        <div className="px-4 pb-4">
          {isLoading ? (
            <div className="py-4 space-y-3">
              <div className="animate-pulse space-y-2">
                <div className={`${uiSurfaces.skeleton} h-4 w-3/4`} />
                <div className={`${uiSurfaces.skeleton} h-4 w-1/2`} />
              </div>
            </div>
          ) : detailData ? (
            <div className="py-4 space-y-4">
              <div>
                <h4 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${uiSurfaces.titleText}`}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-[var(--brand-border-radius-pill)] bg-[var(--brand-color-primary-bg)] text-xs font-bold text-[var(--brand-color-primary)]">1</span>
                  实验步骤
                </h4>
                <ol className="space-y-2">
                  {detailData.steps.map((step, idx) => (
                    <li key={idx} className="flex gap-2 text-sm">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[var(--brand-border-radius-pill)] bg-[var(--brand-color-primary-bg)] text-xs font-bold text-[var(--brand-color-primary)]">
                        {idx + 1}
                      </span>
                      <span className={`leading-relaxed ${uiSurfaces.textSecondary}`}>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {detailData.tips && detailData.tips.length > 0 && (
                <div>
                  <h4 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${uiSurfaces.titleText}`}>
                    <AlertTriangle className="h-4 w-4 text-[var(--brand-color-warning)]" />
                    注意事项
                  </h4>
                  <ul className="space-y-1.5">
                    {detailData.tips.map((tip, idx) => (
                      <li key={idx} className={`flex gap-2 text-xs ${uiSurfaces.textSecondary}`}>
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--brand-color-success)]" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detailData.relatedProducts && detailData.relatedProducts.length > 0 && (
                <div>
                  <h4 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${uiSurfaces.titleText}`}>
                    <Heart className="h-4 w-4 text-[var(--brand-color-error)]" />
                    相关产品
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {detailData.relatedProducts.map((product, idx) => (
                      <Link
                        key={idx}
                        href={`/products?search=${product.code}`}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors hover:border-[var(--brand-color-primary-border-hover)] ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Package className={`h-3.5 w-3.5 ${uiSurfaces.textQuaternary}`} />
                        <span className={`text-xs font-medium ${uiSurfaces.textSecondary}`}>{product.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
