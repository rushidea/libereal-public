'use client';

import { FlaskConical, Droplet, Atom, Scale, Beaker, LineChart } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type CalculatorType = 'dilution' | 'buffer' | 'mw' | 'unit' | 'solution' | 'elisa';

interface CalculatorSelectorProps {
  activeType: CalculatorType;
  onSelect: (type: CalculatorType) => void;
}

export const calculators: { type: CalculatorType; name: string; icon: React.ReactNode; desc: string }[] = [
  { type: 'dilution', name: '溶液稀释', icon: <Droplet size={20} />, desc: 'C₁V₁=C₂V₂' },
  { type: 'buffer', name: '缓冲液配制', icon: <FlaskConical size={20} />, desc: '缓冲体系计算' },
  { type: 'mw', name: '分子量计算', icon: <Atom size={20} />, desc: '化学式 → 分子量' },
  { type: 'unit', name: '单位换算', icon: <Scale size={20} />, desc: 'mM/mL 等浓度' },
  { type: 'solution', name: '溶液配制', icon: <Beaker size={20} />, desc: '质量 → 摩尔浓度' },
  { type: 'elisa', name: 'ELISA曲线拟合与计算', icon: <LineChart size={20} />, desc: '4PL 拟合回算' },
];

export function isCalculatorType(value: string | null): value is CalculatorType {
  return calculators.some((calculator) => calculator.type === value);
}

export default function CalculatorSelector({ activeType, onSelect }: CalculatorSelectorProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
      {calculators.map((calc) => (
        <button
          key={calc.type}
          onClick={() => onSelect(calc.type)}
          className={`flex min-h-20 flex-shrink-0 flex-col items-center gap-1.5 rounded-brand px-4 py-3 transition-all ${uiSurfaces.focusRing} ${
            activeType === calc.type
              ? 'bg-brand-500 text-white shadow-[var(--shadow-panel)]'
              : `${uiSurfaces.panel} ${uiSurfaces.text} ${uiSurfaces.textInteractiveHover}`
          }`}
        >
          <span className={activeType === calc.type ? 'text-white' : uiSurfaces.textInteractive}>
            {calc.icon}
          </span>
          <span className="text-xs font-medium whitespace-nowrap">{calc.name}</span>
          <span className={`text-[10px] ${activeType === calc.type ? 'text-white/80' : uiSurfaces.mutedText}`}>
            {calc.desc}
          </span>
        </button>
      ))}
    </div>
  );
}
