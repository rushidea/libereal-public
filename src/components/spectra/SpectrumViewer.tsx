'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  fluorescenceDyes,
  generateDyeSpectrum,
  getSavedDyeSets,
  saveDyeSet,
  deleteDyeSet,
  SavedDyeSet,
  MAX_DYES_DISPLAY,

} from '@/data/fluorescenceDyes';
import {
  instruments,
  categoryLabels,
  checkDyeCompatibility,
  type Instrument,
  type FilterBand,
  type ManualConfig,
} from '@/data/instruments';
import SpectrumChart from './SpectrumChart';
import DyeSelector from './DyeSelector';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface SpectrumViewerProps {
  userId?: string;
}

type ConfigMode = 'preset' | 'manual';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function SpectrumViewer({ userId }: SpectrumViewerProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savedSets, setSavedSets] = useState<SavedDyeSet[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [configMode, setConfigMode] = useState<ConfigMode>('preset');
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>(instruments[4]); // LSRFortessa
  const [manualConfig, setManualConfig] = useState<ManualConfig>({
    lasers: [405, 488, 561, 640],
    filters: instruments[4].filters,
  });

  const chartRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const instrumentMenuRef = useRef<HTMLDivElement>(null);

  // 加载保存的组合
  useEffect(() => {
    // Mount-time init: load saved dye sets from localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedSets(getSavedDyeSets());
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
      if (instrumentMenuRef.current && !instrumentMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 获取当前激光线
  const currentLasers = configMode === 'preset'
    ? selectedInstrument.lasers
    : manualConfig.lasers.map(wl => ({ wavelength: wl, name: '', color: '' }));

  // 获取当前滤波器
  const currentFilters = configMode === 'preset'
    ? selectedInstrument.filters
    : manualConfig.filters;

  // 切换激光选择
  const toggleLaser = useCallback((wl: number) => {
    setManualConfig(prev => ({
      ...prev,
      lasers: prev.lasers.includes(wl)
        ? prev.lasers.filter(l => l !== wl)
        : [...prev.lasers, wl].sort(),
    }));
  }, []);

  // 切换滤波器选择
  const toggleFilter = useCallback((filter: FilterBand) => {
    setManualConfig(prev => {
      const exists = prev.filters.some(f => f.name === filter.name);
      return {
        ...prev,
        filters: exists
          ? prev.filters.filter(f => f.name !== filter.name)
          : [...prev.filters, filter].sort((a, b) => a.center - b.center),
      };
    });
  }, []);

  const handleToggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      return prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
    });
  }, []);

  const handleClear = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleSave = useCallback(() => {
    if (!saveName.trim() || selectedIds.length === 0) return;
    const newSet = saveDyeSet(saveName.trim(), selectedIds);
    setSavedSets(prev => [newSet, ...prev]);
    setShowSaveModal(false);
    setSaveName('');
  }, [saveName, selectedIds]);

  const handleLoad = useCallback((set: SavedDyeSet) => {
    setSelectedIds(set.dyeIds);
    setShowLoadModal(false);
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteDyeSet(id);
    setSavedSets(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleExportCSV = useCallback(() => {
    setShowExportMenu(false);
    if (selectedIds.length === 0) return;

    const selectedDyes = selectedIds.map(id => fluorescenceDyes.find(d => d.id === id)!);
    const spectra = selectedDyes.map(d => generateDyeSpectrum(d));

    let csv = 'Wavelength';
    spectra.forEach(s => {
      csv += `,${s.abbr}_Excitation,${s.abbr}_Emission`;
    });
    csv += '\n';

    const allWavelengths = new Set<number>();
    spectra.forEach(s => {
      s.excitation.forEach(p => allWavelengths.add(p.wavelength));
      s.emission.forEach(p => allWavelengths.add(p.wavelength));
    });

    Array.from(allWavelengths).sort((a, b) => a - b).forEach(wl => {
      let row = wl.toString();
      spectra.forEach(s => {
        const exc = s.excitation.find(p => p.wavelength === wl);
        const em = s.emission.find(p => p.wavelength === wl);
        row += `,${exc?.intensity ?? ''},${em?.intensity ?? ''}`;
      });
      csv += row + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.download = `fluorescence-spectrum-${Date.now()}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, [selectedIds]);

  // 计算染料兼容性
  const dyeCompatibilities = useMemo(() => {
    const config = configMode === 'preset' ? selectedInstrument : {
      lasers: manualConfig.lasers.map(wl => ({ wavelength: wl })),
      filters: manualConfig.filters,
    };
    const result: Record<string, { laserCompatible: boolean; filterCompatible: boolean; matchingFilters: FilterBand[] }> = {};
    fluorescenceDyes.forEach(dye => {
      result[dye.id] = checkDyeCompatibility(dye, config as Instrument);
    });
    return result;
  }, [configMode, selectedInstrument, manualConfig]);

  // 生成图表数据
  const spectraRaw = selectedIds.map(id => {
    const dye = fluorescenceDyes.find(d => d.id === id);
    if (!dye) return null;
    return generateDyeSpectrum(dye);
  });
  const spectra = spectraRaw.filter((s): s is NonNullable<typeof s> => s !== null);

  const selectedDyes = selectedIds.map(id => fluorescenceDyes.find(d => d.id === id)!);

  return (
    <div className={`${uiSurfaces.panel} rounded-brand ${uiSurfaces.border}`}>
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--surface-border)] p-4">
        <div className="flex items-center gap-2">
          <h3 className={`font-medium ${uiSurfaces.titleText}`}>荧光光谱查看器</h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLoadModal(true)}
              className={`${uiSurfaces.buttonSecondary} rounded-brand px-3 py-1.5 text-sm ${uiSurfaces.focusRing}`}
          >
            我的组合
          </button>

          <button
            onClick={() => setShowSaveModal(true)}
            disabled={selectedIds.length === 0}
              className={`${uiSurfaces.primaryButton} rounded-brand px-3 py-1.5 text-sm ${uiSurfaces.focusRing} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            保存当前组合
          </button>

          {/* 导出菜单 */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => {
                setShowExportMenu(!showExportMenu);
              }}
              className={`${uiSurfaces.buttonSecondary} flex items-center gap-1 rounded-brand px-3 py-1.5 text-sm ${uiSurfaces.focusRing}`}
            >
              导出
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showExportMenu && (
              <div
              className={`absolute right-0 z-50 mt-1 w-32 ${uiSurfaces.panelStrong} rounded-brand ${uiSurfaces.border} shadow-[var(--shadow-panel)]`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowExportMenu(false);

                    const svgEl = document.querySelector('.spectra-chart svg');

                    if (!svgEl) {
                      alert('图表未渲染，请先选择染料');
                      return;
                    }

                    const svgData = new XMLSerializer().serializeToString(svgEl);
                    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                    const url = URL.createObjectURL(svgBlob);
                    const img = new Image();

                    img.onload = () => {
                      const canvas = document.createElement('canvas');
                      canvas.width = img.width * 2;
                      canvas.height = img.height * 2;
                      const ctx = canvas.getContext('2d');
                      if (ctx) {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        const link = document.createElement('a');
                        link.download = `fluorescence-spectrum-${Date.now()}.png`;
                        link.href = canvas.toDataURL('image/png');
                        link.click();
                      }
                      URL.revokeObjectURL(url);
                    };

                    img.onerror = () => {
                      console.error('Image load error');
                      alert('导出失败，请重试');
                    };

                    img.src = url;
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-lg"
                >
                  导出 PNG
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowExportMenu(false);
                    handleExportCSV();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-b-lg"
                >
                  导出 CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 仪器选择器 */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* 左侧：模式切换 + 仪器选择 */}
          <div className="flex flex-wrap items-center gap-4">
            {/* 模式切换 */}
            <div className="flex items-center gap-1 bg-white dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setConfigMode('preset')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  configMode === 'preset'
                    ? 'bg-brand-500 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                预设仪器
              </button>
              <button
                onClick={() => setConfigMode('manual')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  configMode === 'manual'
                    ? 'bg-brand-500 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                手动选择
              </button>
            </div>

            {/* 预设仪器选择 */}
            {configMode === 'preset' ? (
              <div className="relative" ref={instrumentMenuRef}>
                <select
                  value={selectedInstrument.id}
                  onChange={e => {
                    const inst = instruments.find(i => i.id === e.target.value);
                    if (inst) setSelectedInstrument(inst);
                  }}
                  className="pl-3 pr-8 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {Object.entries(categoryLabels).map(([cat, label]) => (
                    <optgroup key={cat} label={label}>
                      {instruments.filter(i => i.category === cat).map(inst => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {/* 激光器选择 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">激光:</span>
                  {[405, 488, 561, 640, 785].map(wl => (
                    <button
                      key={wl}
                      onClick={() => toggleLaser(wl)}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        manualConfig.lasers.includes(wl)
                          ? 'bg-purple-100 dark:bg-purple-900/50 border-purple-400 text-purple-700 dark:text-purple-300'
                          : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {wl}
                    </button>
                  ))}
                </div>
                {/* 滤波器选择 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">通道:</span>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { name: 'FL1', center: 530, bandwidth: 30, min: 515, max: 545, color: '#00FF00' },
                      { name: 'FL2', center: 585, bandwidth: 42, min: 564, max: 606, color: '#FFA500' },
                      { name: 'FL3', center: 670, bandwidth: 30, min: 655, max: 685, color: '#FF6347' },
                      { name: 'FL4', center: 660, bandwidth: 20, min: 650, max: 670, color: '#FF0000' },
                      { name: 'FL5', center: 710, bandwidth: 50, min: 685, max: 735, color: '#DC143C' },
                      { name: 'FL6', center: 780, bandwidth: 60, min: 750, max: 810, color: '#8B008B' },
                    ].map(f => (
                      <button
                        key={f.name}
                        onClick={() => toggleFilter(f)}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                          manualConfig.filters.some(ff => ff.name === f.name)
                            ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-400 text-blue-700 dark:text-blue-300'
                            : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                        }`}
                        title={`${f.center - f.bandwidth/2} - ${f.center + f.bandwidth/2}nm`}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 当前配置摘要 */}
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>
                {currentLasers.map(l => l.wavelength || l).join('+')}nm
              </span>
              <span>|</span>
              <span>{currentFilters.length}通道</span>
            </div>
          </div>

          {/* 右侧：提示文字 */}
          <span className="text-xs text-gray-400">
            💡 不兼容染料显示红色标记
          </span>
        </div>
      </div>

      {/* 光谱图表 */}
      <div ref={chartRef} className={`spectra-chart ${uiSurfaces.panel} p-4`}>
        <SpectrumChart
          spectra={spectra}
          selectedDyes={selectedIds}
        />
      </div>

      {/* 已选染料列表 */}
      {selectedIds.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              已选染料 ({selectedIds.length}/{MAX_DYES_DISPLAY})
            </span>
            <button
              onClick={handleClear}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              清空
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedDyes.map(dye => {
              const compat = dyeCompatibilities[dye.id];

              return (
                <div
                  key={dye.id}
                  className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-700 rounded-full border border-gray-200 dark:border-gray-600"
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: dye.color }}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{dye.abbr}</span>
                  <span className="text-xs text-gray-400">{dye.channel}</span>
                  {compat.matchingFilters.length > 0 && (
                    <span className="text-[10px] px-1 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded">
                      {compat.matchingFilters[0].name}
                    </span>
                  )}
                  <button
                    onClick={() => handleToggle(dye.id)}
                    className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 染料选择器 */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto">
        <DyeSelector
          dyes={fluorescenceDyes}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          dyeCompatibilities={dyeCompatibilities}
        />
      </div>

      {/* 保存组合弹窗 */}
      {showSaveModal && (
        <div className={`${uiSurfaces.overlay} ${uiSurfaces.modalBackdrop}`}>
          <div className={`${uiSurfaces.modal} mx-4 w-full max-w-md rounded-brand p-6 shadow-[var(--shadow-panel-strong)]`}>
            <h3 className={`mb-4 text-lg font-medium ${uiSurfaces.titleText}`}>
              保存荧光组合
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  组合名称
                </label>
                <input
                  type="text"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="例如：我的 Th1/Th2 流式面板"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  autoFocus
                />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">已选染料:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedDyes.map(dye => (
                    <span
                      key={dye.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-sm"
                    >
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: dye.color }}
                      />
                      {dye.abbr}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setSaveName('');
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="px-4 py-2 bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 rounded-lg"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加载组合弹窗 */}
      {showLoadModal && (
        <div className={`${uiSurfaces.overlay} ${uiSurfaces.modalBackdrop}`}>
          <div className={`${uiSurfaces.modal} mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-brand p-6 shadow-[var(--shadow-panel-strong)]`}>
            <h3 className={`mb-4 text-lg font-medium ${uiSurfaces.titleText}`}>
              我的荧光组合
            </h3>
            {savedSets.length === 0 ? (
              <p className="text-center text-gray-500 py-8">暂无保存的组合</p>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {savedSets.map(set => {
                  const dyes = set.dyeIds
                    .map(id => fluorescenceDyes.find(d => d.id === id))
                    .filter(Boolean);
                  return (
                    <div
                      key={set.id}
                      className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 dark:text-gray-200 truncate">
                            {set.name}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {new Date(set.createdAt).toLocaleDateString('zh-CN')}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {dyes.map(dye => (
                              <span
                                key={dye!.id}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs"
                              >
                                <div
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: dye!.color }}
                                />
                                {dye!.abbr}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleLoad(set)}
                            className="p-1.5 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded"
                            title="加载"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1.707.707L10 12.414l-4.293 4.293A1 1 0 014 16V4z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(set.id)}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                            title="删除"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowLoadModal(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
