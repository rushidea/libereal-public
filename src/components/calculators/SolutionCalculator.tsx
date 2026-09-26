'use client';

import { useState, useMemo, useEffect } from 'react';
import { Copy, Save, Check } from 'lucide-react';
import { calculateSolution, saveCalculatorHistory } from '@/data/calculatorData';
import { calculatorInputClass, calculatorSaveInputClass, calculatorPanelClass, calculatorResultClass, calculatorSubPanelClass } from '@/components/calculators/fieldClasses';
import { useSession } from 'next-auth/react';

interface SolutionCalculatorProps {
  onSave?: (name: string, result: unknown) => void;
}

export default function SolutionCalculator({ onSave }: SolutionCalculatorProps) {
  const { data: session } = useSession();
  const [mode, setMode] = useState<'mass-to-molarity' | 'molarity-to-mass'>('mass-to-molarity');
  const [mass, setMass] = useState<string>('');
  const [mw, setMw] = useState<string>('');
  const [volume, setVolume] = useState<string>('');
  const [molarity, setMolarity] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');

  // Derived state: compute solution result from inputs (pure)
  const result = useMemo<Record<string, number | null>>(() => {
    if (mode === 'mass-to-molarity') {
      const massVal = parseFloat(mass);
      const mwVal = parseFloat(mw);
      const volVal = parseFloat(volume);
      if ([massVal, mwVal, volVal].filter((v) => !isNaN(v)).length >= 3) {
        return calculateSolution(massVal, mwVal, volVal);
      }
      return {};
    }
    const molarityVal = parseFloat(molarity);
    const mwVal = parseFloat(mw);
    const volVal = parseFloat(volume);
    if ([molarityVal, mwVal, volVal].filter((v) => !isNaN(v)).length >= 3) {
      const moles = molarityVal * volVal;
      const massCalc = moles * mwVal;
      return { mass: massCalc, molarity: molarityVal, mw: mwVal, volume: volVal };
    }
    return {};
  }, [mode, mass, mw, volume, molarity]);

  // Persist history when result changes
  useEffect(() => {
    if (Object.keys(result).length === 0) return;
    saveCalculatorHistory({
      type: 'solution',
      inputs: { mass: parseFloat(mass), mw: parseFloat(mw), volume: parseFloat(volume) },
      result,
      timestamp: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const getResultText = () => {
    const parts: string[] = [];
    if (result.mass !== null && !isNaN(result.mass as number)) parts.push(`质量 = ${(result.mass as number).toFixed(4)} g`);
    if (result.molarity !== null && !isNaN(result.molarity as number)) parts.push(`浓度 = ${(result.molarity as number).toFixed(4)} M`);
    if (result.mw !== null && !isNaN(result.mw as number)) parts.push(`分子量 = ${(result.mw as number).toFixed(2)} g/mol`);
    if (result.volume !== null && !isNaN(result.volume as number)) parts.push(`体积 = ${(result.volume as number).toFixed(4)} mL`);
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

  const hasResult = Object.values(result).some(v => v !== null && !isNaN(v as number));

  return (
    <div className="space-y-4">
      <div className={`${calculatorPanelClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">溶液配制计算器</h3>

        {/* 模式切换 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('mass-to-molarity')}
            className={`flex-1 py-2 text-xs rounded-lg transition-colors ${
              mode === 'mass-to-molarity'
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            质量 → 摩尔浓度
          </button>
          <button
            onClick={() => setMode('molarity-to-mass')}
            className={`flex-1 py-2 text-xs rounded-lg transition-colors ${
              mode === 'molarity-to-mass'
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            摩尔浓度 → 质量
          </button>
        </div>

        {/* 输入字段 */}
        {mode === 'mass-to-molarity' ? (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">质量 (g)</label>
              <input
                type="number"
                value={mass}
                onChange={(e) => setMass(e.target.value)}
                placeholder="溶质质量"
                className={calculatorInputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">分子量 (g/mol)</label>
              <input
                type="number"
                value={mw}
                onChange={(e) => setMw(e.target.value)}
                placeholder="分子量"
                className={calculatorInputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">体积 (mL)</label>
              <input
                type="number"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="溶剂体积"
                className={calculatorInputClass}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">摩尔浓度 (M)</label>
              <input
                type="number"
                value={molarity}
                onChange={(e) => setMolarity(e.target.value)}
                placeholder="目标浓度"
                className={calculatorInputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">分子量 (g/mol)</label>
              <input
                type="number"
                value={mw}
                onChange={(e) => setMw(e.target.value)}
                placeholder="分子量"
                className={calculatorInputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">体积 (mL)</label>
              <input
                type="number"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="溶剂体积"
                className={calculatorInputClass}
              />
            </div>
          </div>
        )}
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
          <p className="text-sm text-emerald-800 font-mono">{getResultText()}</p>

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
          <strong>公式：</strong><br />
          C = n/V (浓度 = 物质的量/体积)<br />
          n = m/M (物质的量 = 质量/分子量)
        </p>
      </div>
    </div>
  );
}
