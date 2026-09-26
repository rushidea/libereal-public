'use client';

import { useState, useMemo } from 'react';
import { Copy, Save, Check, ChevronDown } from 'lucide-react';
import { bufferSystems, BufferSystem, calculateBuffer, BufferCalculationResult } from '@/data/calculatorData';
import { calculatorInputClass, calculatorSaveInputClass, calculatorPanelClass, calculatorResultClass, calculatorSubPanelClass } from '@/components/calculators/fieldClasses';
import { useSession } from 'next-auth/react';

interface BufferCalculatorProps {
  onSave?: (name: string, result: unknown) => void;
}

const concentrationMultipliers = [
  { value: 0.5, label: '0.5×' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 5, label: '5×' },
  { value: 10, label: '10×' },
];

export default function BufferCalculator({ onSave }: BufferCalculatorProps) {
  const { data: session } = useSession();
  const [selectedBuffer, setSelectedBuffer] = useState<BufferSystem | null>(null);
  const [showBufferList, setShowBufferList] = useState(false);
  const [targetPH, setTargetPH] = useState<string>('');
  const [totalVolume, setTotalVolume] = useState<string>('');
  const [concMultiplier, setConcMultiplier] = useState<number>(1);
  const [copied, setCopied] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');

  // Derived state: compute buffer result from inputs
  const result = useMemo<BufferCalculationResult | null>(() => {
    if (!selectedBuffer || !targetPH || !totalVolume) return null;
    const ph = parseFloat(targetPH);
    const vol = parseFloat(totalVolume);
    if (isNaN(ph) || isNaN(vol)) return null;
    const standardConc = selectedBuffer.standardConc || 50;
    const targetConcM = (standardConc * concMultiplier) / 1000;
    return calculateBuffer(selectedBuffer.name, ph, vol, targetConcM);
  }, [selectedBuffer, targetPH, totalVolume, concMultiplier]);

  const getResultText = () => {
    if (!result || !result.success) return '';
    const standardConc = selectedBuffer?.standardConc || 50;
    const actualConc = standardConc * concMultiplier;
    const lines = [
      `缓冲体系: ${selectedBuffer?.name}`,
      `目标 pH: ${targetPH}`,
      `总体积: ${totalVolume} mL`,
      `浓度: ${actualConc} mM (${concMultiplier}×)`,
      '',
      '各组分质量:',
    ];
    result.components.forEach(comp => {
      lines.push(`${comp.name}: ${comp.mass.toFixed(4)} g`);
    });
    if (result.notes) {
      lines.push('', `备注: ${result.notes}`);
    }
    return lines.join('\n');
  };

  const copyResult = () => {
    navigator.clipboard.writeText(getResultText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSave = () => {
    if (onSave && saveName && result) {
      onSave(saveName, result);
      setShowSave(false);
      setSaveName('');
    }
  };

  const hasResult = result !== null && result.success;
  const standardConc = selectedBuffer?.standardConc || 50;
  const actualConc = standardConc * concMultiplier;

  return (
    <div className="space-y-4">
      <div className={`${calculatorPanelClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">缓冲液配制计算器</h3>

        {/* 缓冲体系选择 */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">缓冲体系</label>
          <div className="relative">
            <button
              onClick={() => setShowBufferList(!showBufferList)}
              className={`${calculatorInputClass} text-left flex items-center justify-between`}
            >
              <span className={selectedBuffer ? 'text-gray-800' : 'text-gray-400'}>
                {selectedBuffer ? `${selectedBuffer.name} (标准浓度: ${selectedBuffer.standardConc || 50}mM)` : '选择缓冲体系'}
              </span>
              <ChevronDown size={16} className="text-gray-400" />
            </button>
            {showBufferList && (
            <div className={`absolute z-10 mt-1 w-full ${calculatorSubPanelClass} max-h-60 overflow-y-auto`}>
                {bufferSystems.map((buffer) => (
                  <button
                    key={buffer.name}
                    onClick={() => {
                      setSelectedBuffer(buffer);
                      setShowBufferList(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 flex justify-between items-center"
                  >
                    <span className="text-gray-700">{buffer.name}</span>
                    <span className="text-xs text-gray-400">{buffer.standardConc || 50}mM</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">目标 pH</label>
            <input
              type="number"
              step="0.01"
              value={targetPH}
              onChange={(e) => setTargetPH(e.target.value)}
              placeholder="7.4"
              className={calculatorInputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">总体积 (mL)</label>
            <input
              type="number"
              value={totalVolume}
              onChange={(e) => setTotalVolume(e.target.value)}
              placeholder="100"
              className={calculatorInputClass}
            />
          </div>
        </div>

        {/* 浓度倍数选择 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">浓度倍数 (标准浓度: {standardConc}mM)</label>
          <div className="flex gap-2">
            {concentrationMultipliers.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setConcMultiplier(opt.value)}
                className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${
                  concMultiplier === opt.value
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            目标浓度: {actualConc} mM
          </p>
        </div>

        {selectedBuffer && (
          <div className="mt-3 p-2 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">
              适用 pH 范围: <span className="font-medium">{selectedBuffer.适用pH}</span>
            </p>
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
          <div className="space-y-2">
            {result.components.map((comp, idx) => (
              <div key={idx} className="flex justify-between items-center py-1.5 border-b border-emerald-100 last:border-0">
                <span className="text-sm text-emerald-800">{comp.name}</span>
                <span className="text-sm font-mono text-emerald-700 font-medium">{comp.mass.toFixed(4)} g</span>
              </div>
            ))}
            <div className="pt-2 border-t border-emerald-200">
              <span className="text-xs text-emerald-600">加水定容至 {totalVolume} mL</span>
            </div>
          </div>

          {result.notes && (
            <p className="mt-2 text-xs text-emerald-600 italic">{result.notes}</p>
          )}

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

      {!hasResult && result && !result.success && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm text-red-600">{result.notes || '计算失败'}</p>
        </div>
      )}

      <div className={`${calculatorSubPanelClass} p-3`}>
        <p className="text-xs text-gray-500">
          <strong>提示：</strong>计算结果基于 Henderson-Hasselbalch 方程估算，
          实际配制时需用 pH 计校准，并根据具体情况适当调整。
        </p>
      </div>
    </div>
  );
}
