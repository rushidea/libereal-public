'use client';

import { useState, useMemo, useEffect } from 'react';
import { Copy, Save, Check } from 'lucide-react';
import { calculateDilution, saveCalculatorHistory } from '@/data/calculatorData';
import { calculatorInputClass, calculatorSaveInputClass, calculatorPanelClass, calculatorResultClass, calculatorSubPanelClass } from '@/components/calculators/fieldClasses';
import { useSession } from 'next-auth/react';

interface DilutionCalculatorProps {
  onSave?: (name: string, result: unknown) => void;
}

export default function DilutionCalculator({ onSave }: DilutionCalculatorProps) {
  const { data: session } = useSession();
  const [c1, setC1] = useState<string>('');
  const [v1, setV1] = useState<string>('');
  const [c2, setC2] = useState<string>('');
  const [v2, setV2] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');

  const inputs = [
    { key: 'c1', label: 'C₁', value: c1, setValue: setC1, placeholder: '原浓度', unit: 'M' },
    { key: 'v1', label: 'V₁', value: v1, setValue: setV1, placeholder: '原体积', unit: 'mL' },
    { key: 'c2', label: 'C₂', value: c2, setValue: setC2, placeholder: '目标浓度', unit: 'M' },
    { key: 'v2', label: 'V₂', value: v2, setValue: setV2, placeholder: '目标体积', unit: 'mL' },
  ];

  // Derived state: compute dilution result from inputs (pure)
  const result = useMemo<Record<string, number | null>>(() => {
    const c1Val = parseFloat(c1);
    const v1Val = parseFloat(v1);
    const c2Val = parseFloat(c2);
    const v2Val = parseFloat(v2);

    if ([c1Val, v1Val, c2Val, v2Val].filter((v) => !isNaN(v)).length >= 3) {
      return calculateDilution(
        isNaN(c1Val) ? undefined : c1Val,
        isNaN(v1Val) ? undefined : v1Val,
        isNaN(c2Val) ? undefined : c2Val,
        isNaN(v2Val) ? undefined : v2Val,
      );
    }
    return {};
  }, [c1, v1, c2, v2]);

  // Persist history as side-effect when result changes
  useEffect(() => {
    if (Object.keys(result).length === 0) return;
    const c1Val = parseFloat(c1);
    const v1Val = parseFloat(v1);
    const c2Val = parseFloat(c2);
    const v2Val = parseFloat(v2);
    saveCalculatorHistory({
      type: 'dilution',
      inputs: { c1: c1Val, v1: v1Val, c2: c2Val, v2: v2Val },
      result,
      timestamp: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const getResultText = () => {
    const parts: string[] = [];
    if (result.c1 !== null && !isNaN(result.c1 as number)) parts.push(`C₁ = ${(result.c1 as number).toFixed(4)} M`);
    if (result.v1 !== null && !isNaN(result.v1 as number)) parts.push(`V₁ = ${(result.v1 as number).toFixed(4)} mL`);
    if (result.c2 !== null && !isNaN(result.c2 as number)) parts.push(`C₂ = ${(result.c2 as number).toFixed(4)} M`);
    if (result.v2 !== null && !isNaN(result.v2 as number)) parts.push(`V₂ = ${(result.v2 as number).toFixed(4)} mL`);
    return parts.join('  |  ');
  };

  const copyResult = () => {
    const text = getResultText();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSave = () => {
    if (onSave && saveName) {
      onSave(saveName, result);
      setShowSave(false);
      setSaveName('');
    }
  };

  const resultText = getResultText();
  const hasResult = Object.values(result).some(v => v !== null && !isNaN(v as number));

  return (
    <div className="space-y-4">
      <div className={`${calculatorPanelClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">溶液稀释计算器 (C₁V₁ = C₂V₂)</h3>

        <div className="grid grid-cols-2 gap-3">
          {inputs.map((input) => (
            <div key={input.key}>
              <label className="block text-xs text-gray-500 mb-1">
                {input.label} ({input.unit})
              </label>
              <input
                type="number"
                value={input.value}
                onChange={(e) => input.setValue(e.target.value)}
                placeholder={input.placeholder}
                className={calculatorInputClass}
              />
            </div>
          ))}
        </div>
      </div>

      {hasResult && (
        <div className={`${calculatorResultClass} p-4`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-emerald-700">计算结果</h4>
            <div className="flex gap-2">
              <button
                onClick={copyResult}
                className="p-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
                title="复制结果"
              >
                {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} className="text-gray-400" />}
              </button>
              {session && (
                <button
                  onClick={() => setShowSave(!showSave)}
                  className="p-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
                  title="保存配方"
                >
                  <Save size={16} className="text-gray-400" />
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-emerald-800 font-mono">{resultText}</p>

          {showSave && session && (
            <div className="mt-3 pt-3 border-t border-emerald-200">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="输入配方名称"
                className={calculatorSaveInputClass}
              />
              <button
                onClick={handleSave}
                disabled={!saveName}
                className="w-full py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          )}
        </div>
      )}

      <div className={`${calculatorSubPanelClass} p-3`}>
        <p className="text-xs text-gray-500">
          <strong>提示：</strong>输入任意三个值，自动计算第四个值。
          公式：C₁V₁ = C₂V₂（稀释前后溶质量守恒）
        </p>
      </div>
    </div>
  );
}
