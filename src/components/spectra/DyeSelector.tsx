'use client';

import { FluorescenceDye } from '@/data/fluorescenceDyes';
import { MAX_DYES_DISPLAY } from '@/data/fluorescenceDyes';
import { type FilterBand } from '@/data/instruments';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface DyeSelectorProps {
  dyes: FluorescenceDye[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  dyeCompatibilities?: Record<string, { laserCompatible: boolean; filterCompatible: boolean; matchingFilters: FilterBand[] }>;
}

const categoryLabels: Record<string, string> = {
  violet: '紫光 (405nm)',
  blue: '蓝光 (488nm)',
  green: '绿光 (488nm)',
  yellow: '黄绿 (561nm)',
  red: '红光 (640nm)',
  'far-red': '远红 (640nm)',
};

const categoryOrder = ['violet', 'blue', 'green', 'yellow', 'red', 'far-red'];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function DyeSelector({ dyes, selectedIds, onToggle, disabled, dyeCompatibilities }: DyeSelectorProps) {
  const groupedDyes = categoryOrder.reduce((acc, cat) => {
    acc[cat] = dyes.filter(d => d.category === cat);
    return acc;
  }, {} as Record<string, FluorescenceDye[]>);

  const selectedCount = selectedIds.length;
  const isAtMax = selectedCount >= MAX_DYES_DISPLAY;

  return (
    <div className="space-y-4">
      {/* 已选计数 */}
      <div className="flex items-center justify-between text-sm">
        <span className={uiSurfaces.textSecondary}>
          已选 {selectedCount}/{MAX_DYES_DISPLAY} 条光谱
        </span>
        {isAtMax && (
          <span className="text-orange-500 text-xs">已达上限，请先移除部分染料</span>
        )}
      </div>

      {/* 分类染料列表 */}
      {categoryOrder.map(category => {
        const categoryDyes = groupedDyes[category];
        if (categoryDyes.length === 0) return null;

        return (
          <div key={category}>
            <h4 className={`mb-2 text-xs font-medium uppercase tracking-wider ${uiSurfaces.mutedText}`}>
              {categoryLabels[category]}
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {categoryDyes.map(dye => {
                const isSelected = selectedIds.includes(dye.id);
                const isDisabled = !isSelected && isAtMax;
                const compat = dyeCompatibilities?.[dye.id];
                const isCompatible = compat?.laserCompatible && compat?.filterCompatible;
                const isPartiallyCompatible = compat && !isCompatible;

                return (
                  <button
                    key={dye.id}
                    onClick={() => !isDisabled && onToggle(dye.id)}
                    disabled={isDisabled}
                    className={`
                      relative p-2 rounded-lg border-2 text-left transition-all
                      ${isSelected
                        ? 'border-gray-800 dark:border-slate-700 bg-gray-50 dark:bg-gray-700/50'
                        : isDisabled
                          ? 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 opacity-50 cursor-not-allowed'
                          : isPartiallyCompatible
                            ? 'border-red-300 dark:border-red-700 hover:border-red-400 dark:hover:border-red-600 bg-red-50/30 dark:bg-red-900/10'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/30'
                      }
                    `}
                  >
                    {/* 颜色指示条 */}
                    <div
                      className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
                      style={{ backgroundColor: dye.color }}
                    />

                    <div className="flex items-center gap-2 mt-1">
                      {/* 颜色圆点 */}
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: dye.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${uiSurfaces.text}`}>
                          {dye.abbr}
                        </p>
                        <p className={`text-xs ${uiSurfaces.mutedText}`}>
                          {dye.emissionPeak}nm
                        </p>
                      </div>
                    </div>

                    {/* 兼容性/通道标签 */}
                    <div className="mt-1 flex items-center justify-between">
                      {compat && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          isCompatible
                            ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
                            : 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                        }`}>
                          {isCompatible ? compat.matchingFilters[0]?.name || '✓' : '✗'}
                        </span>
                      )}
                      {!compat && (
                        <span className={`text-[10px] ${uiSurfaces.mutedText}`}>
                          {dye.channel}
                        </span>
                      )}
                      {isSelected && (
                        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
