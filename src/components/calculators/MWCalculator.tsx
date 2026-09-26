'use client';

import { useState, useMemo, useEffect } from 'react';
import { Copy, Save, Check, Search } from 'lucide-react';
import { atomicWeights, functionalGroups, calculateMolecularWeight, saveCalculatorHistory } from '@/data/calculatorData';
import { calculatorCompactInputClass, calculatorInputClass, calculatorSaveInputClass, calculatorPanelClass, calculatorResultClass, calculatorSubPanelClass } from '@/components/calculators/fieldClasses';
import { useSession } from 'next-auth/react';

interface MWCalculatorProps {
  onSave?: (name: string, result: unknown) => void;
}

export default function MWCalculator({ onSave }: MWCalculatorProps) {
  const { data: session } = useSession();
  const [formula, setFormula] = useState('');
  const [copied, setCopied] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showGroupList, setShowGroupList] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  // Derived state: compute MW from formula (pure)
  const result = useMemo<{ mw: number; composition: Record<string, number> } | null>(() => {
    if (!formula.trim()) return null;
    return calculateMolecularWeight(formula);
  }, [formula]);

  // Persist history when result changes
  useEffect(() => {
    if (!result) return;
    saveCalculatorHistory({
      type: 'mw',
      inputs: { formula },
      result: { mw: result.mw, composition: result.composition },
      timestamp: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const filteredGroups = Object.entries(functionalGroups).filter(([key, val]) =>
    key.toLowerCase().includes(groupSearch.toLowerCase()) ||
    val.name.includes(groupSearch)
  );

  const getResultText = () => {
    if (!result) return '';
    const parts = [`分子量: ${result.mw.toFixed(4)} g/mol`];
    const compositionParts = Object.entries(result.composition)
      .map(([elem, count]) => `${elem}: ${count}`)
      .join(', ');
    if (compositionParts) {
      parts.push(`原子组成: ${compositionParts}`);
    }
    return parts.join('\n');
  };

  const copyResult = () => {
    navigator.clipboard.writeText(getResultText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSave = () => {
    if (onSave && saveName && result) {
      onSave(saveName, { mw: result.mw, composition: result.composition });
      setShowSave(false);
      setSaveName('');
    }
  };

  const insertGroup = (groupKey: string) => {
    setFormula(prev => prev + groupKey);
    setShowGroupList(false);
    setGroupSearch('');
  };

  const hasResult = result !== null;

  return (
    <div className="space-y-4">
      <div className={`${calculatorPanelClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">分子量计算器</h3>

        {/* 化学式输入 */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">化学式</label>
          <input
            type="text"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder="例如: NaCl, C6H12O6, -OH"
            className={`${calculatorInputClass} font-mono`}
          />
        </div>

        {/* 常用基团快捷插入 */}
        <div className="relative mb-3">
          <button
            onClick={() => setShowGroupList(!showGroupList)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
          >
            <Search size={14} />
            插入常用基团
          </button>
          {showGroupList && (
            <div className={`absolute z-10 mt-1 w-64 ${calculatorSubPanelClass} max-h-60 overflow-y-auto`}>
              <div className="p-2 border-b border-gray-100">
                <input
                  type="text"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder="搜索基团..."
                  className={calculatorCompactInputClass}
                />
              </div>
              {filteredGroups.map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => insertGroup(key)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 flex justify-between items-center"
                >
                  <span className="font-mono text-brand-600">{key}</span>
                  <span className="text-xs text-gray-400">{val.name} ({val.mw})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 常用示例 */}
        <div className="flex flex-wrap gap-2">
          {['H2O', 'NaCl', 'C6H12O6', 'Tris', 'EDTA'].map((ex) => (
            <button
              key={ex}
              onClick={() => setFormula(ex)}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors font-mono"
            >
              {ex}
            </button>
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
          <div className="text-lg font-bold text-emerald-800 mb-2">
            {result.mw.toFixed(4)} g/mol
          </div>
          {Object.keys(result.composition).length > 0 && (
            <div className="text-sm text-emerald-700">
              <span className="text-xs text-emerald-600">原子组成:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(result.composition).map(([elem, count]) => (
                  <span key={elem} className="px-2 py-0.5 bg-emerald-100 rounded text-xs font-mono">
                    {elem} × {count} = {((atomicWeights[elem] || 0) * count).toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
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

      <div className={`${calculatorSubPanelClass} p-3`}>
        <p className="text-xs text-gray-500">
          <strong>支持的格式：</strong>元素符号后加数字，如 NaCl、C6H12O6。
          支持常用基团如 -OH、-COOH 等。
        </p>
      </div>
    </div>
  );
}
