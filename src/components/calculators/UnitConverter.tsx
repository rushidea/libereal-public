'use client';

import { useState, useMemo, useEffect } from 'react';
import { Copy, Save, Check } from 'lucide-react';
import {
  concentrationUnits,
  massUnits,
  volumeUnits,
  perVolumeUnits,
  convertMolarPerVolume,
  formatConcentrationValue,
  formatMolarPerVolumeUnit,
  saveCalculatorHistory,
} from '@/data/calculatorData';
import { calculatorInputClass, calculatorSaveInputClass, calculatorPanelClass, calculatorResultClass, calculatorSubPanelClass } from '@/components/calculators/fieldClasses';
import { useSession } from 'next-auth/react';

type UnitCategory = 'concentration' | 'mass' | 'volume';

interface UnitConverterProps {
  onSave?: (name: string, result: unknown) => void;
}

const inputClass = calculatorInputClass;

export default function UnitConverter({ onSave }: UnitConverterProps) {
  const { data: session } = useSession();
  const [category, setCategory] = useState<UnitCategory>('concentration');
  const [inputValue, setInputValue] = useState<string>('5');
  const [fromUnit, setFromUnit] = useState<string>('mM');
  const [toUnit, setToUnit] = useState<string>('μM');
  const [fromMolar, setFromMolar] = useState<string>('mM');
  const [fromVolume, setFromVolume] = useState<string>('dL');
  const [toMolar, setToMolar] = useState<string>('M');
  const [toVolume, setToVolume] = useState<string>('mL');
  const [copied, setCopied] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');

  const unitsByCategory = {
    concentration: concentrationUnits,
    mass: massUnits,
    volume: volumeUnits,
  };

  const currentUnits = unitsByCategory[category];

  const result = useMemo<number | null>(() => {
    const val = parseFloat(inputValue);
    if (isNaN(val)) return null;

    if (category === 'concentration') {
      return convertMolarPerVolume(val, fromMolar, fromVolume, toMolar, toVolume);
    }

    const fromFactor = currentUnits[fromUnit]?.factor || 1;
    const toFactor = currentUnits[toUnit]?.factor || 1;
    return val * (fromFactor / toFactor);
  }, [inputValue, fromUnit, toUnit, category, currentUnits, fromMolar, fromVolume, toMolar, toVolume]);

  const fromLabel =
    category === 'concentration'
      ? formatMolarPerVolumeUnit(fromMolar, fromVolume)
      : fromUnit;
  const toLabel =
    category === 'concentration'
      ? formatMolarPerVolumeUnit(toMolar, toVolume)
      : toUnit;

  useEffect(() => {
    if (result === null) return;
    const val = parseFloat(inputValue);
    saveCalculatorHistory({
      type: 'unit',
      inputs:
        category === 'concentration'
          ? { value: val, fromMolar, fromVolume, toMolar, toVolume, category }
          : { value: val, fromUnit, toUnit, category },
      result:
        category === 'concentration'
          ? { converted: result, from: fromLabel, to: toLabel }
          : { converted: result },
      timestamp: Date.now(),
    });
  }, [result, inputValue, fromUnit, toUnit, category, fromMolar, fromVolume, toMolar, toVolume, fromLabel, toLabel]);

  const handleCategoryChange = (newCategory: UnitCategory) => {
    setCategory(newCategory);
    const units = unitsByCategory[newCategory];
    const unitKeys = Object.keys(units);
    setFromUnit(unitKeys[0]);
    setToUnit(unitKeys[1] || unitKeys[0]);
    setInputValue(newCategory === 'concentration' ? '5' : '');
  };

  const getResultText = () => {
    if (result === null) return '';
    const formatted = formatConcentrationValue(result);
    return `${inputValue} ${fromLabel} = ${formatted} ${toLabel}`;
  };

  const copyResult = () => {
    navigator.clipboard.writeText(getResultText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSave = () => {
    if (onSave && saveName && result !== null) {
      const val = parseFloat(inputValue);
      onSave(saveName, {
        value: val,
        fromUnit: fromLabel,
        toUnit: toLabel,
        result,
        category,
      });
      setShowSave(false);
      setSaveName('');
    }
  };

  const hasResult = result !== null;

  return (
    <div className="space-y-4">
      <div className={`${calculatorPanelClass} p-4`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">单位换算器</h3>
        <p className="mb-3 text-xs text-gray-500">
          浓度模式支持「摩尔量 / 体积」组合单位，例如 mM/dL、M/mL、μM/μL。
        </p>

        <div className="flex gap-2 mb-4">
          {(['concentration', 'mass', 'volume'] as UnitCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategoryChange(cat)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                category === cat
                  ? 'bg-brand-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat === 'concentration' ? '浓度' : cat === 'mass' ? '质量' : '体积'}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">数值</label>
          <input
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="输入数值"
            className={inputClass}
          />
        </div>

        {category === 'concentration' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[5rem] flex-1">
                <label className="block text-xs text-gray-500 mb-1">从（摩尔）</label>
                <select
                  value={fromMolar}
                  onChange={(e) => setFromMolar(e.target.value)}
                  className={inputClass}
                >
                  {Object.entries(concentrationUnits).map(([key, val]) => (
                    <option key={key} value={key}>
                      {val.name}
                    </option>
                  ))}
                </select>
              </div>
              <span className="pb-2 text-sm font-medium text-gray-500">/</span>
              <div className="min-w-[5rem] flex-1">
                <label className="block text-xs text-gray-500 mb-1">每（体积）</label>
                <select
                  value={fromVolume}
                  onChange={(e) => setFromVolume(e.target.value)}
                  className={inputClass}
                >
                  {Object.entries(perVolumeUnits).map(([key, val]) => (
                    <option key={key} value={key}>
                      {val.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-center text-gray-400 text-sm">↓</div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[5rem] flex-1">
                <label className="block text-xs text-gray-500 mb-1">到（摩尔）</label>
                <select
                  value={toMolar}
                  onChange={(e) => setToMolar(e.target.value)}
                  className={inputClass}
                >
                  {Object.entries(concentrationUnits).map(([key, val]) => (
                    <option key={key} value={key}>
                      {val.name}
                    </option>
                  ))}
                </select>
              </div>
              <span className="pb-2 text-sm font-medium text-gray-500">/</span>
              <div className="min-w-[5rem] flex-1">
                <label className="block text-xs text-gray-500 mb-1">每（体积）</label>
                <select
                  value={toVolume}
                  onChange={(e) => setToVolume(e.target.value)}
                  className={inputClass}
                >
                  {Object.entries(perVolumeUnits).map(([key, val]) => (
                    <option key={key} value={key}>
                      {val.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">从</label>
              <select
                value={fromUnit}
                onChange={(e) => setFromUnit(e.target.value)}
                className={inputClass}
              >
                {Object.entries(currentUnits).map(([key, val]) => (
                  <option key={key} value={key}>
                    {val.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="pt-5 text-gray-400">→</div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">到</label>
              <select
                value={toUnit}
                onChange={(e) => setToUnit(e.target.value)}
                className={inputClass}
              >
                {Object.entries(currentUnits).map(([key, val]) => (
                  <option key={key} value={key}>
                    {val.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {hasResult && (
        <div className={`${calculatorResultClass} p-4`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-emerald-700">换算结果</h4>
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
          <p className="text-lg font-bold text-emerald-800 font-mono break-all">{getResultText()}</p>

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
        <p className="text-xs text-gray-500 leading-relaxed">
          <strong>浓度换算示例：</strong>
          <br />
          5 mM/dL = 5×10⁻⁵ M/mL（先统一到 mol/L，再换目标分母）
          <br />
          1 M/L = 1 mM/mL = 1000 μM/mL
        </p>
      </div>
    </div>
  );
}
