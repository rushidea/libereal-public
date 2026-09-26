'use client';

import { useState } from 'react';
import { Clock, Trash2, ChevronRight } from 'lucide-react';
import CalculatorSelector, { CalculatorType } from './CalculatorSelector';
import { uiSurfaces } from '@/lib/ui-surfaces';
import DilutionCalculator from './DilutionCalculator';
import BufferCalculator from './BufferCalculator';
import MWCalculator from './MWCalculator';
import UnitConverter from './UnitConverter';
import SolutionCalculator from './SolutionCalculator';
import ElisaCurveCalculator from './ElisaCurveCalculator';
import { getCalculatorHistory, clearCalculatorHistory, CalculatorHistory, formatConcentrationValue } from '@/data/calculatorData';
import ErrorBoundary from '@/components/ErrorBoundary';

interface CalculatorsPanelProps {
  onSave?: (type: CalculatorType, name: string, result: unknown) => void;
  initialType?: CalculatorType;
}

const calculatorComponents = {
  dilution: DilutionCalculator,
  buffer: BufferCalculator,
  mw: MWCalculator,
  unit: UnitConverter,
  solution: SolutionCalculator,
  elisa: ElisaCurveCalculator,
};

const calculatorNames: Record<CalculatorType, string> = {
  dilution: '溶液稀释',
  buffer: '缓冲液配制',
  mw: '分子量计算',
  unit: '单位换算',
  solution: '溶液配制',
  elisa: 'ELISA曲线拟合与计算',
};

export default function CalculatorsPanel({ onSave, initialType }: CalculatorsPanelProps) {
  const [activeType, setActiveType] = useState<CalculatorType>(initialType ?? 'dilution');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CalculatorHistory[]>(() => getCalculatorHistory());

  const ActiveCalculator = calculatorComponents[activeType];

  const handleSave = (name: string, result: unknown) => {
    if (onSave) {
      onSave(activeType, name, result);
    }
    // 刷新历史
    setHistory(getCalculatorHistory());
  };

  const handleClearHistory = () => {
    clearCalculatorHistory();
    setHistory([]);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getHistoryResult = (item: CalculatorHistory) => {
    if (item.type === 'dilution') {
      const r = item.result as Record<string, number | null>;
      const parts: string[] = [];
      if (r.c1 !== null) parts.push(`C₁=${(r.c1 as number).toFixed(2)}`);
      if (r.v1 !== null) parts.push(`V₁=${(r.v1 as number).toFixed(2)}`);
      if (r.c2 !== null) parts.push(`C₂=${(r.c2 as number).toFixed(2)}`);
      if (r.v2 !== null) parts.push(`V₂=${(r.v2 as number).toFixed(2)}`);
      return parts.join(' ');
    }
    if (item.type === 'buffer') {
      return `${item.result.bufferName || '缓冲液'} pH ${item.result.pH}`;
    }
    if (item.type === 'mw') {
      return `MW=${(item.result.mw as number)?.toFixed(2) || '-'} g/mol`;
    }
    if (item.type === 'unit') {
      const r = item.result as Record<string, unknown>;
      if (typeof r.from === 'string' && typeof r.to === 'string') {
        const val = typeof r.converted === 'number' ? formatConcentrationValue(r.converted) : '-';
        return `${item.inputs.value} ${r.from} → ${val} ${r.to}`;
      }
      const val = typeof item.result.result === 'number' ? item.result.result.toFixed(4) : item.result.result;
      return `${item.result.value} ${item.result.fromUnit} → ${val} ${item.result.toUnit}`;
    }
    if (item.type === 'solution') {
      const r = item.result;
      if (r.molarity !== null) return `C=${(r.molarity as number).toFixed(4)} M`;
      if (r.mass !== null) return `m=${(r.mass as number).toFixed(4)} g`;
    }
    if (item.type === 'elisa') {
      const r = item.result;
      const rSquared = typeof r.rSquared === 'number' ? r.rSquared.toFixed(4) : '-';
      return `4PL R²=${rSquared}，样本 ${r.sampleCount ?? 0} 个`;
    }
    return '';
  };

  return (
    <div className="space-y-4">
      {/* 计算器选择器 */}
      <CalculatorSelector activeType={activeType} onSelect={setActiveType} />

      {/* 计算器内容 - wrapped in ErrorBoundary so one calculator's bug
          doesn't break the whole calculators panel */}
      <div className="min-h-[300px]">
        <ErrorBoundary>
          <ActiveCalculator onSave={handleSave} />
        </ErrorBoundary>
      </div>

      {/* 历史记录 */}
      <div className={`${uiSurfaces.panel} rounded-brand overflow-hidden`}>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`w-full px-4 py-3 flex items-center justify-between text-sm font-medium ${uiSurfaces.text} hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing} transition-colors`}
        >
          <div className="flex items-center gap-2">
            <Clock size={16} className={uiSurfaces.mutedText} />
            历史记录 ({history.length})
          </div>
          <ChevronRight size={16} className={`${uiSurfaces.mutedText} transition-transform ${showHistory ? 'rotate-90' : ''}`} />
        </button>

        {showHistory && (
          <div className="border-t border-[var(--surface-border)]">
            {history.length === 0 ? (
              <div className={`px-4 py-6 text-center text-sm ${uiSurfaces.mutedText}`}>
                暂无历史记录
              </div>
            ) : (
              <>
                <div className="max-h-60 overflow-y-auto">
                  {history.map((item, index) => (
                    <button
                      key={`${item.type}-${item.timestamp}-${index}`}
                      onClick={() => setActiveType(item.type)}
                      className={`w-full px-4 py-2.5 flex items-center justify-between hover:bg-[var(--surface-hover)] border-b border-[var(--surface-border)] last:border-0 ${uiSurfaces.focusRing}`}
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${uiSurfaces.textInteractive}`}>
                            {calculatorNames[item.type]}
                          </span>
                          <span className={`text-[10px] ${uiSurfaces.mutedText}`}>
                            {formatTime(item.timestamp)}
                          </span>
                        </div>
                        <div className={`mt-0.5 truncate text-xs ${uiSurfaces.textSecondary}`}>
                          {getHistoryResult(item)}
                        </div>
                      </div>
                      <ChevronRight size={14} className={`${uiSurfaces.mutedText} flex-shrink-0`} />
                    </button>
                  ))}
                </div>
                <div className="border-t border-[var(--surface-border)] px-4 py-2">
                  <button
                    onClick={handleClearHistory}
                    className={`flex items-center gap-1.5 text-xs text-[var(--brand-color-error-text)] hover:text-[var(--brand-color-error)] ${uiSurfaces.focusRing} transition-colors`}
                  >
                    <Trash2 size={12} />
                    清除历史
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
