'use client';

import { useState } from 'react';
import { X, ShoppingCart, Trash2, Clipboard, ArrowDown } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface QuickOrderModalProps {
  onClose: () => void;
}

interface ParsedItem {
  name: string;
  brand: string;
  catalogNumber: string;
  quantity: number;
  unit: string;
}

const COMMON_UNITS = ['支', '瓶', '盒', '袋', '套', '次', '孔', 'test', 'mg', 'g', 'mL', 'L', 'μg'];

const BRAND_SUGGESTIONS = [
  'Abcam', 'Thermo Fisher', 'Sigma-Aldrich', 'Fisher Scientific', 'CST', 'Cell Signaling Technology',
  'BD Biosciences', 'BioLegend', 'Santa Cruz', 'R&D Systems', 'PeproTech', 'Novus Biologicals',
  'ImmunoWay', 'Proteintech', 'SAB', 'Signalway Antibody', 'Affinity', 'CUSABIO', 'Elabscience',
  'Boster', 'ABclonal', 'HUABIO', 'GenScript', '金斯瑞', '爱博泰克', '优宝生物',
];
const PRODUCT_NAME_SUGGESTIONS = [
  'Anti-', 'Anti-Human', 'Anti-Mouse', 'Anti-Rat',
  'ELISA Kit', 'Recombinant Protein', 'FITC', 'Alexa Fluor', 'HRP',
  'CD3', 'CD4', 'CD8', 'CD19', 'CD20', 'CD34', 'CD45', 'PD-1', 'PD-L1', 'TNF-α', 'IL-6', 'IL-10', 'IFN-γ',
  'VEGF', 'EGFR', 'HER2', 'KRAS', 'BRAF', 'p53', 'Caspase', 'Bcl-2', ' Bax',
  'GAPDH', 'β-Actin', 'Tubulin', 'Histone',
];;

const toggleClass = `flex min-h-[var(--brand-control-height-sm)] flex-1 items-center justify-center gap-1 rounded-[var(--brand-border-radius)] px-3 py-2 text-sm font-medium transition-colors ${uiSurfaces.focusRing}`;
const fieldClass = `${uiSurfaces.input} w-full px-3 py-2.5 text-sm`;
const compactFieldClass = `${uiSurfaces.inputCompact} px-2 py-1.5 text-xs`;
const submitClass = `${uiSurfaces.buttonPrimary} w-full min-h-12 px-4`;

export default function QuickOrderModal({ onClose }: QuickOrderModalProps) {
  const { addQuickOrderItem } = useCart();
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [form, setForm] = useState({
    name: '',
    brand: '',
    catalogNumber: '',
    quantity: 1,
    unit: '支',
  });
  const [batchText, setBatchText] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [added, setAdded] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.brand || !form.catalogNumber) return;
    addQuickOrderItem({
      name: form.name,
      brand: form.brand,
      catalogNumber: form.catalogNumber,
      quantity: Number(form.quantity),
      unit: form.unit,
    });
    setAdded(true);
    setTimeout(() => { setAdded(false); }, 1500);
  };

  function parseLine(line: string): Partial<ParsedItem> {
    // Try formats: "Brand | Cat# | Name" or "Brand · Cat# · Name" or tab/comma separated
    const cleaned = line.trim().replace(/\r$/, '');
    if (!cleaned) return {};
    // Split by common separators
    const parts = cleaned.split(/[\t|，,·]/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return { brand: parts[0], catalogNumber: parts[1], name: parts.slice(2).join(' ') };
    } else if (parts.length === 2) {
      return { brand: parts[0], catalogNumber: parts[1] };
    } else if (parts.length === 1) {
      return { name: parts[0] };
    }
    return {};
  }

  function handleParse() {
    const lines = batchText.split('\n').filter(l => l.trim());
    const items: ParsedItem[] = lines.map(line => {
      const parsed = parseLine(line);
      return {
        name: parsed.name || '',
        brand: parsed.brand || '',
        catalogNumber: parsed.catalogNumber || '',
        quantity: 1,
        unit: '支',
      };
    });
    setParsedItems(items);
  }

  function updateParsed(index: number, field: keyof ParsedItem, value: string | number) {
    setParsedItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function removeParsed(index: number) {
    setParsedItems(prev => prev.filter((_, i) => i !== index));
  }

  function handleBatchAdd() {
    const valid = parsedItems.filter(i => i.brand && i.catalogNumber);
    valid.forEach(item => {
      addQuickOrderItem({
        name: item.name || `${item.brand} ${item.catalogNumber}`,
        brand: item.brand,
        catalogNumber: item.catalogNumber,
        quantity: Number(item.quantity) || 1,
        unit: item.unit,
      });
    });
    if (valid.length > 0) {
      setAdded(true);
      setTimeout(() => {
        setAdded(false);
        setBatchText('');
        setParsedItems([]);
        setMode('single');
      }, 1500);
    }
  }

  return (
    <div className={`${uiSurfaces.overlay} ${uiSurfaces.modalBackdrop}`}>
      <div className={`my-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal}`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--brand-color-border)] px-6 py-4">
          <div>
            <h2 className={`text-lg font-bold ${uiSurfaces.titleText}`}>快速下单</h2>
            <p className={`mt-0.5 text-xs ${uiSurfaces.textQuaternary}`}>填写产品信息，添加到购物车</p>
          </div>
          <button onClick={onClose} className={`inline-flex h-10 w-10 items-center justify-center rounded-[var(--brand-border-radius)] ${uiSurfaces.textInteractive} transition-colors hover:bg-[var(--brand-color-bg-hover)] ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}>
            <X size={20} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 px-6 pt-4">
          <button
            onClick={() => { setMode('single'); setBatchText(''); setParsedItems([]); }}
            className={`${toggleClass} ${
              mode === 'single' ? 'bg-[var(--brand-color-primary-bg)] text-[var(--brand-color-text-interactive-active)]' : `${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--brand-color-bg-hover)]`
            }`}
          >
            单个添加
          </button>
          <button
            onClick={() => { setMode('batch'); }}
            className={`${toggleClass} ${
              mode === 'batch' ? 'bg-[var(--brand-color-primary-bg)] text-[var(--brand-color-text-interactive-active)]' : `${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--brand-color-bg-hover)]`
            }`}
          >
            <Clipboard size={14} /> 粘贴导入
          </button>
        </div>

        {/* Single form */}
        {mode === 'single' && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className={`mb-1 block text-sm font-medium ${uiSurfaces.textSecondary}`}>
                产品名称 <span className="text-[var(--brand-color-error-text)]">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm(form => ({...form, name: e.target.value }))}
                placeholder="如：Anti-Human CD3 Antibody"
                required
                list="productNameList"
                className={fieldClass}
              />
              <datalist id="productNameList">
                {PRODUCT_NAME_SUGGESTIONS.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`mb-1 block text-sm font-medium ${uiSurfaces.textSecondary}`}>
                  品牌 <span className="text-[var(--brand-color-error-text)]">*</span>
                </label>
                <input
                  value={form.brand}
                  onChange={(e) => setForm(form => ({...form, brand: e.target.value }))}
                  placeholder="如：Abcam"
                  required
                  list="brandList"
                  className={fieldClass}
                />
                <datalist id="brandList">
                  {BRAND_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className={`mb-1 block text-sm font-medium ${uiSurfaces.textSecondary}`}>
                  Catalog No. <span className="text-[var(--brand-color-error-text)]">*</span>
                </label>
                <input
                  value={form.catalogNumber}
                  onChange={(e) => setForm(form => ({...form, catalogNumber: e.target.value }))}
                  placeholder="如：ab123456"
                  required
                  className={fieldClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`mb-1 block text-sm font-medium ${uiSurfaces.textSecondary}`}>数量</label>
                <input
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm(form => ({...form, quantity: Number(e.target.value) }))}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={`mb-1 block text-sm font-medium ${uiSurfaces.textSecondary}`}>单位</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm(form => ({...form, unit: e.target.value }))}
                  className={fieldClass}
                >
                  {COMMON_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              className={`${submitClass} ${
                added ? 'border-[var(--brand-color-success)] bg-[var(--brand-color-success)]' : ''
              }`}
            >
              {added ? <>已添加 ✓</> : <><ShoppingCart size={16} />加入购物车</>}
            </button>
          </form>
        )}

        {/* Batch paste mode */}
        {mode === 'batch' && (
          <div className="p-6 space-y-4">
            {parsedItems.length === 0 ? (
              <>
                <div>
                  <label className={`mb-1 block text-sm font-medium ${uiSurfaces.textSecondary}`}>
                    粘贴产品信息
                  </label>
                  <textarea
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    placeholder={`粘贴格式示例（支持多种分隔符）：\nAbcam | ab123456 | Anti-Human CD3 Antibody\nThermo Fisher · MA5-12345 | FITC Anti-Mouse CD19\nSigma-Aldrich, SAB-001, Recombinant Human IL-6`}
                    rows={6}
                    className={`${fieldClass} resize-none`}
                  />
                </div>
                <div className={`rounded-[var(--brand-border-radius)] p-3 ${uiSurfaces.panel}`}>
                  <p className={`text-xs ${uiSurfaces.textSecondary}`}>
                    <strong>支持格式：</strong>品牌 · Catalog No. · 产品名（任意分隔符：| · , \t）
                    <br />每行一个产品，粘贴后可逐行编辑确认。
                  </p>
                </div>
                <button
                  onClick={handleParse}
                  disabled={!batchText.trim()}
                  className={`${uiSurfaces.buttonSecondary} w-full px-4 disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <ArrowDown size={14} /> 解析并预览
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${uiSurfaces.textSecondary}`}>已解析 {parsedItems.length} 个产品</span>
                  <button onClick={() => setParsedItems([])} className={`text-xs ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}>重新粘贴</button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {parsedItems.map((item, index) => (
                    <div key={index} className={`space-y-2 rounded-[var(--brand-border-radius)] p-3 ${uiSurfaces.panel}`}>
                      <div className="flex items-start gap-2">
                        <span className={`mt-2 w-5 text-xs ${uiSurfaces.textQuaternary}`}>{index + 1}.</span>
                        <div className="grid grid-cols-2 gap-2 flex-1">
                          <input
                            value={item.brand}
                            onChange={(e) => updateParsed(index, 'brand', e.target.value)}
                            placeholder="品牌"
                            list="brandList"
                            className={compactFieldClass}
                          />
                          <input
                            value={item.catalogNumber}
                            onChange={(e) => updateParsed(index, 'catalogNumber', e.target.value)}
                            placeholder="Catalog No."
                            className={compactFieldClass}
                          />
                          <input
                            value={item.name}
                            onChange={(e) => updateParsed(index, 'name', e.target.value)}
                            placeholder="产品名称（选填）"
                            list="productNameList"
                            className={`${compactFieldClass} col-span-2`}
                          />
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateParsed(index, 'quantity', Number(e.target.value))}
                            placeholder="数量"
                            className={`${compactFieldClass} w-16`}
                          />
                          <select
                            value={item.unit}
                            onChange={(e) => updateParsed(index, 'unit', e.target.value)}
                            className={compactFieldClass}
                          >
                            {COMMON_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <button onClick={() => removeParsed(index)} className={`mt-1.5 ${uiSurfaces.textInteractive} transition-colors hover:text-[var(--brand-color-error-text)] ${uiSurfaces.focusRing}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleBatchAdd}
                  disabled={parsedItems.filter(i => i.brand && i.catalogNumber).length === 0}
                  className={`${submitClass} ${
                    added
                      ? 'border-[var(--brand-color-success)] bg-[var(--brand-color-success)]'
                      : 'disabled:cursor-not-allowed disabled:opacity-50'
                  }`}
                >
                  {added
                    ? <>已全部添加 ✓</>
                    : <><ShoppingCart size={16} />一次性添加 {parsedItems.filter(i => i.brand && i.catalogNumber).length} 个产品到购物车</>
                  }
                </button>
              </>
            )}
          </div>
        )}

        {/* Tips */}
        <div className="px-6 pb-6">
          <div className="rounded-[var(--brand-border-radius)] border border-[var(--brand-color-warning-border)] bg-[var(--brand-color-warning-bg)] p-4">
            <p className="text-xs text-[var(--brand-color-warning-text)]">
              <strong>提示：</strong>快速下单用于采购库中没有的产品。提交后销售团队会在 1–2 个工作日内确认价格和交期。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
