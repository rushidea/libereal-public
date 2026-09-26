'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  FileSpreadsheet,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  calculateElisaFit,
  fourPL,
  saveCalculatorHistory,
  type ElisaFitResult,
  type ElisaSampleInput,
  type ElisaStandardInput,
} from '@/data/calculatorData';
import {
  ELISA_IMPORT_MAX_FILE_BYTES,
  getElisaImportExtension,
  isAllowedElisaImportExtension,
  isAllowedElisaImportMimeType,
  isElisaImportedRows,
  parseElisaTableRows,
  type ElisaImportedRows,
} from '@/data/elisa-import';
import { calculatorTableInputClass, calculatorTextareaClass, calculatorPanelClass, calculatorSubPanelClass, calculatorResultClass } from '@/components/calculators/fieldClasses';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface ElisaCurveCalculatorProps {
  onSave?: (name: string, result: unknown) => void;
  guideTitle?: string;
  guideItems?: string[];
  toolTitle?: string;
  toolSummary?: string;
}

type StandardRow = {
  id: string;
  concentration: string;
  odValues: string;
};

type SampleRow = {
  id: string;
  name: string;
  odValues: string;
  dilution: string;
};

/** SPEC: table body text-sm + text-gray-800; headers text-gray-600; force dark text on white cards in dark mode */
const tableClass = 'w-full text-left text-sm text-gray-800 dark:text-slate-200';
const tableHeadClass = 'text-gray-600 dark:text-gray-600';
const tableBodyClass = 'text-gray-800 dark:text-slate-200';
const tableInputClass = calculatorTableInputClass;

const defaultStandards: StandardRow[] = [
  { id: 'std-1', concentration: '0.156', odValues: '0.09, 0.10' },
  { id: 'std-2', concentration: '0.313', odValues: '0.16, 0.15' },
  { id: 'std-3', concentration: '0.625', odValues: '0.29, 0.31' },
  { id: 'std-4', concentration: '1.25', odValues: '0.55, 0.57' },
  { id: 'std-5', concentration: '2.5', odValues: '0.98, 1.02' },
  { id: 'std-6', concentration: '5', odValues: '1.56, 1.60' },
  { id: 'std-7', concentration: '10', odValues: '2.05, 2.08' },
];

const defaultSamples: SampleRow[] = [
  { id: 'sample-1', name: '样本 1', odValues: '0.72, 0.75', dilution: '1' },
  { id: 'sample-2', name: '样本 2', odValues: '1.22, 1.19', dilution: '2' },
];

function parseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().replace(/,/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOdValues(value: string): number[] {
  return value
    .split(/[\s,;，；]+/)
    .map((part) => parseNumber(part))
    .filter((part): part is number => part !== null);
}

function standardRowsToInput(rows: StandardRow[]): ElisaStandardInput[] {
  return rows.map((row) => ({
    id: row.id,
    concentration: parseNumber(row.concentration),
    odValues: parseOdValues(row.odValues),
  }));
}

function sampleRowsToInput(rows: SampleRow[]): ElisaSampleInput[] {
  return rows.map((row, index) => ({
    id: row.id,
    name: row.name.trim() || `样本 ${index + 1}`,
    odValues: parseOdValues(row.odValues),
    dilution: Math.max(1, parseNumber(row.dilution) ?? 1),
  }));
}

function formatNumber(value: number | null | undefined, digits = 4): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) return value.toExponential(3);
  return value.toFixed(digits);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function splitTextRows(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,/).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function buildCsv(result: ElisaFitResult): string {
  const rows = [
    ['ELISA 4PL 拟合报告'],
    ['R2', result.rSquared !== null ? result.rSquared.toFixed(6) : ''],
    ['A 下/上平台', result.params ? result.params.a : ''],
    ['B 斜率', result.params ? result.params.b : ''],
    ['C EC50', result.params ? result.params.c : ''],
    ['D 下/上平台', result.params ? result.params.d : ''],
    [],
    ['标准品浓度', '平均 OD', 'SD', 'CV%', '拟合 OD', '残差'],
    ...result.standards.map((standard) => [
      standard.concentration ?? '',
      standard.stats?.mean ?? '',
      standard.stats?.sd ?? '',
      standard.stats?.cv ?? '',
      standard.fittedOd ?? '',
      standard.residual ?? '',
    ]),
    [],
    ['样本', '平均 OD', 'SD', 'CV%', '稀释倍数', '回算浓度', '最终浓度', '标记'],
    ...result.samples.map((sample) => [
      sample.name,
      sample.stats?.mean ?? '',
      sample.stats?.sd ?? '',
      sample.stats?.cv ?? '',
      sample.dilution,
      sample.calculatedConcentration ?? '',
      sample.finalConcentration ?? '',
      sample.flags.join('; '),
    ]),
    [],
    ['质控结论'],
    ...result.qc.map((item) => [item]),
  ];

  return rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

const defaultGuideItems = [
  '在「标准品」中填写各浓度点及 OD 复孔（建议 ≥4 点，复孔用逗号分隔，如 0.12, 0.13）。',
  '在「样本」中填写样本名、OD 复孔和稀释倍数（未稀释填 1）。',
  '拟合成功后查看标准曲线、R²、标准品/样本质控与回算浓度；超出曲线范围会标注提示。',
  '可上传 Excel/CSV，或在「粘贴导入」区按示例格式批量填入后点「应用」。',
];

export default function ElisaCurveCalculator({
  onSave,
  guideTitle = '使用说明',
  guideItems = defaultGuideItems,
  toolTitle = 'ELISA 标准曲线拟合',
  toolSummary = '输入标准品浓度和 OD 复孔，使用 4PL 拟合曲线并回算样本浓度。',
}: ElisaCurveCalculatorProps) {
  const [standards, setStandards] = useState<StandardRow[]>(defaultStandards);
  const [samples, setSamples] = useState<SampleRow[]>(defaultSamples);
  const [pasteText, setPasteText] = useState('');
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const chartRef = useRef<HTMLDivElement>(null);

  const standardInputs = useMemo(() => standardRowsToInput(standards), [standards]);
  const sampleInputs = useMemo(() => sampleRowsToInput(samples), [samples]);
  const result = useMemo(() => calculateElisaFit(standardInputs, sampleInputs), [standardInputs, sampleInputs]);

  const curveData = useMemo(() => {
    if (!result.success || !result.params || !result.range) return [];
    const minLog = Math.log10(result.range.min);
    const maxLog = Math.log10(result.range.max);
    return Array.from({ length: 80 }, (_, index) => {
      const concentration = Math.pow(10, minLog + ((maxLog - minLog) * index) / 79);
      return { concentration, od: fourPL(concentration, result.params as NonNullable<typeof result.params>) };
    });
  }, [result]);
  const standardChartData = result.standards
    .filter((standard) => standard.concentration && standard.stats)
    .map((standard) => ({ concentration: standard.concentration as number, od: standard.stats?.mean as number }));

  useEffect(() => {
    if (!result.success) return;
    saveCalculatorHistory({
      type: 'elisa',
      inputs: { standards: standards.length, samples: samples.length },
      result: {
        rSquared: result.rSquared ?? 0,
        sampleCount: result.samples.length,
        qc: result.qc.join('；'),
      },
      timestamp: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.success, result.rSquared, result.samples.length]);

  function updateStandard(id: string, field: keyof StandardRow, value: string) {
    setStandards((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function updateSample(id: string, field: keyof SampleRow, value: string) {
    setSamples((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function applyParsedRows(parsed: ElisaImportedRows) {
    if (parsed.standards.length > 0) {
      setStandards(parsed.standards.map((row) => ({ ...row, id: makeId('std') })));
    }
    if (parsed.samples.length > 0) {
      setSamples(parsed.samples.map((row) => ({ ...row, id: makeId('sample') })));
    }
  }

  function handlePasteImport() {
    try {
      setImportError('');
      applyParsedRows(parseElisaTableRows(splitTextRows(pasteText)));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '表格读取失败，请检查内容后重试。');
    }
  }

  async function handleExcelUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError('');
    const extension = getElisaImportExtension(file.name);
    if (!isAllowedElisaImportExtension(file.name)) {
      setImportError('仅支持 CSV 或 XLSX 文件。');
      event.target.value = '';
      return;
    }
    if (file.size === 0 || file.size > ELISA_IMPORT_MAX_FILE_BYTES) {
      setImportError(`文件大小需在 1 字节至 ${(ELISA_IMPORT_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB 之间。`);
      event.target.value = '';
      return;
    }
    if (!isAllowedElisaImportMimeType(file.type, extension)) {
      setImportError(`文件类型与 .${extension} 扩展名不匹配。`);
      event.target.value = '';
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/api/calculators/elisa-import', {
        method: 'POST',
        body: formData,
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => null) as { error?: unknown; rows?: unknown } | null;
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '表格读取失败，请检查文件后重试。');
      }
      if (!isElisaImportedRows(data?.rows)) {
        throw new Error('服务器返回的表格结果格式无效。');
      }
      applyParsedRows(data.rows);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '表格读取失败，请稍后重试。');
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  }

  function handleCsvExport() {
    const blob = new Blob([`\uFEFF${buildCsv(result)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `elisa-4pl-report-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleChartExport() {
    if (!chartRef.current) return;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(chartRef.current, { backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `elisa-standard-curve-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function handleSaveReport() {
    if (onSave) onSave('ELISA 4PL 拟合报告', result);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="space-y-4">
      <div className={`${calculatorSubPanelClass} rounded-brand p-3`}>
        <p className={`mb-2 text-xs font-semibold ${uiSurfaces.text}`}>{guideTitle}</p>
        <ul className={`space-y-1 text-xs leading-relaxed ${uiSurfaces.mutedText}`}>
          {guideItems.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${calculatorPanelClass} p-4`}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className={`text-sm font-semibold ${uiSurfaces.titleText}`}>{toolTitle}</h3>
            <p className={`mt-1 text-xs leading-relaxed ${uiSurfaces.mutedText}`}>{toolSummary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex min-h-10 items-center gap-1.5 rounded-brand px-3 py-2 text-xs font-medium ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing} ${importing ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {importing ? '正在读取…' : '上传 Excel'}
              <input type="file" accept=".xlsx,.csv" onChange={handleExcelUpload} disabled={importing} className="hidden" />
            </label>
            <button onClick={handleCsvExport} className={`inline-flex min-h-10 items-center gap-1.5 ${uiSurfaces.buttonSecondary} rounded-brand px-3 py-2 text-xs font-medium ${uiSurfaces.focusRing}`}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button onClick={() => window.print()} className={`inline-flex min-h-10 items-center gap-1.5 ${uiSurfaces.buttonSecondary} rounded-brand px-3 py-2 text-xs font-medium ${uiSurfaces.focusRing}`}>
              <Printer className="h-3.5 w-3.5" />
              打印
            </button>
          </div>
        </div>

        {importError ? (
          <div className="mb-4 flex items-start gap-2 rounded-brand border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{importError}</span>
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
          <div className={`min-w-0 ${calculatorSubPanelClass} p-3`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-gray-600">标准品</p>
              <button
                onClick={() => setStandards((current) => [...current, { id: makeId('std'), concentration: '', odValues: '' }])}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-brand-700 hover:bg-brand-50"
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </button>
            </div>
            <div className="min-w-0 overflow-x-auto">
              <table className={`${tableClass} min-w-[460px]`}>
                <thead className={tableHeadClass}>
                  <tr>
                    <th className="px-2 py-1.5 font-medium">浓度</th>
                    <th className="px-2 py-1.5 font-medium">OD 复孔</th>
                    <th className="w-10 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody className={tableBodyClass}>
                  {standards.map((row) => (
                    <tr key={row.id} className="border-t border-gray-50">
                      <td className="px-2 py-1.5">
                        <input value={row.concentration} onChange={(event) => updateStandard(row.id, 'concentration', event.target.value)} className={tableInputClass} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={row.odValues} onChange={(event) => updateStandard(row.id, 'odValues', event.target.value)} placeholder="0.12, 0.13" className={tableInputClass} />
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => setStandards((current) => current.filter((item) => item.id !== row.id))} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" aria-label="删除标准品">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`${calculatorSubPanelClass} p-3`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-gray-600">粘贴导入</p>
              <button onClick={handlePasteImport} className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">应用</button>
            </div>
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'支持表头：type/name/concentration/OD1/OD2/dilution\nstandard,,0.156,0.09,0.10,\nsample,样本A,,0.72,0.75,2'}
              className={`h-44 ${calculatorTextareaClass}`}
            />
          </div>
        </div>

        <div className={`mt-3 ${calculatorSubPanelClass} p-3`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-600">样本</p>
            <button
              onClick={() => setSamples((current) => [...current, { id: makeId('sample'), name: `样本 ${current.length + 1}`, odValues: '', dilution: '1' }])}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-brand-700 hover:bg-brand-50"
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </button>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className={`${tableClass} min-w-[620px]`}>
              <thead className={tableHeadClass}>
                <tr>
                  <th className="px-2 py-1.5 font-medium">样本名</th>
                  <th className="px-2 py-1.5 font-medium">OD 复孔</th>
                  <th className="px-2 py-1.5 font-medium">稀释倍数</th>
                  <th className="w-10 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {samples.map((row) => (
                  <tr key={row.id} className="border-t border-gray-50">
                    <td className="px-2 py-1.5">
                      <input value={row.name} onChange={(event) => updateSample(row.id, 'name', event.target.value)} className={tableInputClass} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.odValues} onChange={(event) => updateSample(row.id, 'odValues', event.target.value)} className={tableInputClass} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={row.dilution} onChange={(event) => updateSample(row.id, 'dilution', event.target.value)} className={tableInputClass} />
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => setSamples((current) => current.filter((item) => item.id !== row.id))} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" aria-label="删除样本">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={`${calculatorResultClass} p-4`}>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className={`text-sm font-semibold ${uiSurfaces.titleText}`}>拟合报告</h4>
            <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>{result.success ? '4PL 曲线已生成，样本浓度按稀释倍数校正。' : result.message}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleChartExport} disabled={!result.success} className={`inline-flex min-h-10 items-center gap-1.5 ${uiSurfaces.buttonSecondary} rounded-brand px-3 py-2 text-xs font-medium ${uiSurfaces.focusRing} disabled:cursor-not-allowed disabled:opacity-60`}>
              <Camera className="h-3.5 w-3.5" />
              保存曲线图
            </button>
            <button onClick={handleSaveReport} className={`inline-flex min-h-10 items-center gap-1.5 ${uiSurfaces.primaryButton} rounded-brand px-3 py-2 text-xs font-medium ${uiSurfaces.focusRing}`}>
              {saved ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
              {saved ? '已保存' : '保存报告'}
            </button>
          </div>
        </div>

        {!result.success ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{result.message}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-brand-50 px-3 py-2">
                <p className="text-xs text-brand-700">R²</p>
                <p className="mt-1 text-sm font-semibold text-brand-900">{formatNumber(result.rSquared, 5)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">EC50 (C)</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatNumber(result.params?.c, 4)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">斜率 (B)</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatNumber(result.params?.b, 4)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-500">曲线范围</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatNumber(result.range?.min)} - {formatNumber(result.range?.max)}</p>
              </div>
            </div>

            <div ref={chartRef} className={`mt-4 ${calculatorSubPanelClass} p-3`}>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart margin={{ top: 10, right: 18, bottom: 44, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="concentration" type="number" scale="log" domain={['dataMin', 'dataMax']} allowDataOverflow tickFormatter={(value) => formatNumber(Number(value), 2)} label={{ value: '浓度（log）', position: 'outside', offset: 20 }} />
                    <YAxis dataKey="od" type="number" tickFormatter={(value) => formatNumber(Number(value), 2)} label={{ value: 'OD', angle: -90, position: 'insideLeft' }} />
                    <Tooltip formatter={(value) => formatNumber(Number(value), 4)} labelFormatter={(value) => `浓度 ${formatNumber(Number(value), 4)}`} />
                    <Legend />
                    <Line name="4PL 拟合曲线" data={curveData} dataKey="od" type="monotone" dot={false} stroke="#2563eb" strokeWidth={2} />
                    <Scatter name="标准品均值" data={standardChartData} dataKey="od" fill="#16a34a" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className={`min-w-0 ${calculatorSubPanelClass} p-3`}>
            <p className="mb-2 text-xs font-semibold text-gray-600">标准品结果</p>
            <div className="min-w-0 overflow-x-auto">
              <table className={`${tableClass} min-w-[520px]`}>
                <thead className={tableHeadClass}>
                  <tr>
                    <th className="px-2 py-1.5">浓度</th>
                    <th className="px-2 py-1.5">平均 OD</th>
                    <th className="px-2 py-1.5">CV%</th>
                    <th className="px-2 py-1.5">残差</th>
                  </tr>
                </thead>
                <tbody className={tableBodyClass}>
                  {result.standards.map((standard) => (
                    <tr key={standard.id} className="border-t border-gray-50">
                      <td className="px-2 py-1.5">{standard.concentration ?? '-'}</td>
                      <td className="px-2 py-1.5">{formatNumber(standard.stats?.mean)}</td>
                      <td className="px-2 py-1.5">{formatNumber(standard.stats?.cv, 2)}</td>
                      <td className="px-2 py-1.5">{formatNumber(standard.residual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`${calculatorSubPanelClass} p-3`}>
            <p className="mb-2 text-xs font-semibold text-gray-600">质控结论</p>
            <div className="space-y-2">
              {result.qc.map((item) => (
                <div key={item} className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${item.includes('未见') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`mt-3 ${calculatorSubPanelClass} p-3`}>
          <p className="mb-2 text-xs font-semibold text-gray-600">样本结果</p>
          <div className="min-w-0 overflow-x-auto">
            <table className={`${tableClass} min-w-[760px]`}>
              <thead className={tableHeadClass}>
                <tr>
                  <th className="px-2 py-1.5">样本</th>
                  <th className="px-2 py-1.5">平均 OD</th>
                  <th className="px-2 py-1.5">CV%</th>
                  <th className="px-2 py-1.5">稀释倍数</th>
                  <th className="px-2 py-1.5">回算浓度</th>
                  <th className="px-2 py-1.5">最终浓度</th>
                  <th className="px-2 py-1.5">标记</th>
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {result.samples.map((sample) => (
                  <tr key={sample.id} className="border-t border-gray-50">
                    <td className="px-2 py-1.5 font-medium">{sample.name}</td>
                    <td className="px-2 py-1.5">{formatNumber(sample.stats?.mean)}</td>
                    <td className="px-2 py-1.5">{formatNumber(sample.stats?.cv, 2)}</td>
                    <td className="px-2 py-1.5">{sample.dilution}</td>
                    <td className="px-2 py-1.5">{formatNumber(sample.calculatedConcentration)}</td>
                    <td className="px-2 py-1.5 font-semibold">{formatNumber(sample.finalConcentration)}</td>
                    <td className="px-2 py-1.5">
                      {sample.flags.length > 0 ? (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{sample.flags.join('；')}</span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">可定量</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
