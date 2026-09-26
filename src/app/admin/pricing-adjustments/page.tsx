'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Layers3,
  Loader2,
  PackagePlus,
  PackageSearch,
  ShieldCheck,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import { productCategories } from '@/data/categories';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { normalizeSpreadsheetCell, parseCsvRows } from '@/lib/csv-parser';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';
import {
  applyCatalogMatchResults,
  applyImportedReviewDecision,
  confirmNameConflictReviewRows,
  DEFAULT_FILE_ADJUSTMENT_REASON,
  getPricingPreviewReadiness,
  groupMissingCatalogProducts,
  importedRowHasFilePrices,
  importedRowIsMissing,
  importedRowNeedsReview,
  importedRowsNeedCatalogRematch,
  parsePricingAdjustmentImport,
  reopenMissingCatalogRows,
  reviewRowNeedsBrandChoice,
  summarizeImportedAdjustmentRows,
  toCatalogMatchItem,
  toCatalogPriceItem,
  type ImportedAdjustmentRow,
} from '@/lib/pricing-adjustment-import';
import type { CatalogMatchResult, CatalogNameReviewItem } from '@/lib/pricing-adjustment-rules';

type ScopeMode = 'category' | 'catalog';
type PriceField = 'price' | 'promotionalPrice' | 'originalPrice';
type AdjustmentMode = 'percent' | 'amount' | 'set' | 'file';
type Direction = 'increase' | 'decrease';

type PreviewSample = {
  productId: string;
  variantId: string | null;
  brand: string;
  catalogNumber: string;
  name: string;
  currentPrice: number | null;
  nextPrice: number;
  floored: boolean;
  fieldLabel?: string;
};

type PreviewResult = {
  matchedCount: number;
  changeCount: number;
  skippedInquiryCount: number;
  skippedUnchangedCount: number;
  skippedMissingCount: number;
  flooredCount: number;
  unmatchedCatalogs: string[];
  reviewCount?: number;
  reviewItems?: CatalogNameReviewItem[];
  samples: PreviewSample[];
  updatedCount?: number;
};

const REVIEW_LIST_LIMIT = 200;

function pricingActionError(error: unknown, fallback: string): string {
  if (error === 'Admin MFA required' || error === 'Recent MFA verification required' || error === '安全验证已失效，请重新验证') {
    return '身份确认已失效，请再次点确认并完成验证。';
  }
  if (error === 'Admin authenticator policy required') return '当前账号尚未完成管理员验证方式设置。';
  return typeof error === 'string' && error.trim() ? error : fallback;
}

const PRICE_FIELDS: Array<{ value: PriceField; label: string; description: string }> = [
  { value: 'price', label: '市场价', description: '商品正常销售价格' },
  { value: 'promotionalPrice', label: '促销价', description: '活动期间优先使用的价格' },
  { value: 'originalPrice', label: '目录价', description: '商品展示的基准价格' },
];

const PAGE_SIZE = 20;
const MAX_IMPORT_ROWS = 50000;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function formatPrice(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
}

function catalogItemKey(catalogNumber: string, spec: string): string {
  return `${catalogNumber.trim().toLocaleLowerCase()}::${spec.trim().toLocaleLowerCase()}`;
}

function ReviewWorkbench({
  title,
  description,
  items,
  brandChoices,
  onBrandChoice,
  onConfirm,
  onSkip,
  onConfirmNameConflicts,
}: {
  title: string;
  description: string;
  items: ImportedAdjustmentRow[];
  brandChoices: Record<string, string>;
  onBrandChoice: (key: string, brand: string) => void;
  onConfirm: (row: ImportedAdjustmentRow, brand?: string) => void;
  onSkip: (row: ImportedAdjustmentRow) => void;
  onConfirmNameConflicts: () => void;
}) {
  if (items.length === 0) return null;
  const visible = items.slice(0, REVIEW_LIST_LIMIT);
  const nameConflicts = items.filter((row) => !reviewRowNeedsBrandChoice(row)).length;
  return (
    <div className="overflow-hidden border-t border-amber-100 bg-amber-50/40">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-950">{title}</p>
          <p className="mt-1 text-xs text-amber-900">{description}共 {items.length.toLocaleString('zh-CN')} 条{items.length > REVIEW_LIST_LIMIT ? `，下列为前 ${REVIEW_LIST_LIMIT} 条` : ''}。确认后再次生成预览即可写入这些货号。</p>
        </div>
        {nameConflicts > 0 && (
          <button
            type="button"
            onClick={onConfirmNameConflicts}
            className={`inline-flex min-h-10 shrink-0 items-center px-4 text-sm font-medium ${uiSurfaces.buttonSecondary}`}
          >
            确认 {nameConflicts.toLocaleString('zh-CN')} 条名称冲突
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-y border-amber-100 bg-amber-50 text-xs text-amber-900">
            <tr>
              <th className="px-4 py-2 text-left font-medium">行</th>
              <th className="px-4 py-2 text-left font-medium">表格商品名</th>
              <th className="px-4 py-2 text-left font-medium">货号</th>
              <th className="px-4 py-2 text-left font-medium">规格</th>
              <th className="px-4 py-2 text-left font-medium">站内商品</th>
              <th className="px-4 py-2 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100 bg-white">
            {visible.map((row) => {
              const key = `${row.rowNumber}:${catalogItemKey(row.catalogNumber, row.spec)}`;
              const needsBrand = reviewRowNeedsBrandChoice(row);
              const selected = brandChoices[key] || row.candidateBrands?.[0] || row.brand || '';
              return (
                <tr key={key}>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{row.rowNumber}</td>
                  <td className="px-4 py-2.5 text-gray-700">{row.name || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900">{row.catalogNumber}</td>
                  <td className="px-4 py-2.5 text-gray-700">{row.spec || '主规格'}</td>
                  <td className="px-4 py-2.5 text-gray-700">{row.siteName || row.note}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {needsBrand && (
                        <select
                          value={selected}
                          onChange={(event) => onBrandChoice(key, event.target.value)}
                          className={`min-w-28 ${uiSurfaces.input}`}
                        >
                          <option value="">选择品牌</option>
                          {(row.candidateBrands ?? []).map((brand) => (
                            <option key={brand} value={brand}>{brand}</option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={needsBrand && !selected}
                        onClick={() => onConfirm(row, needsBrand ? selected : (row.candidateBrands?.[0] || row.brand))}
                        className="inline-flex min-h-9 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        确认写入
                      </button>
                      <button
                        type="button"
                        onClick={() => onSkip(row)}
                        className="inline-flex min-h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700"
                      >
                        跳过
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PricingAdjustmentsPage() {
  const { begin: beginMfaStepUp, dialog: mfaDialog } = useAdminMfaStepUp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('category');
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [fileName, setFileName] = useState('');
  const [importedRows, setImportedRows] = useState<ImportedAdjustmentRow[]>([]);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [templateDownloading, setTemplateDownloading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importPage, setImportPage] = useState(1);
  const [priceField, setPriceField] = useState<PriceField>('price');
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>('percent');
  const [direction, setDirection] = useState<Direction>('increase');
  const [amount, setAmount] = useState('');
  const [includeVariants, setIncludeVariants] = useState(true);
  const [reason, setReason] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [applyMessage, setApplyMessage] = useState('');
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createMessage, setCreateMessage] = useState('');
  const [classifySuggestions, setClassifySuggestions] = useState<Record<string, string>>({});
  const [reviewBrandChoices, setReviewBrandChoices] = useState<Record<string, string>>({});
  const [appliedCatalogKeys, setAppliedCatalogKeys] = useState<string[]>([]);
  const previewPayloadRef = useRef<Record<string, unknown> | null>(null);
  const previewGenerationRef = useRef(0);

  function invalidatePreview() {
    previewGenerationRef.current += 1;
    previewPayloadRef.current = null;
    setPreviewLoading(false);
    setPreviewVisible(false);
    setPreviewResult(null);
    setApplyMessage('');
  }

  useEffect(() => {
    let active = true;
    fetch('/api/admin/products?take=20', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { stats?: { topBrands?: string[] } } | null) => {
        if (active) setBrandOptions(data?.stats?.topBrands ?? []);
      })
      .catch(() => {
        if (active) setBrandOptions([]);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const hasFileRows = importedRows.some((row) => importedRowHasFilePrices(row) && (
      row.status === 'ready'
      || row.status === 'warning'
      || importedRowIsMissing(row)
    ));
    if (adjustmentMode === 'file' && !(scopeMode === 'catalog' && hasFileRows)) {
      setAdjustmentMode('percent');
    }
  }, [adjustmentMode, importedRows, scopeMode]);

  const subcategoryOptions = useMemo(
    () => productCategories.find((item) => item.name === category)?.sub.map((item) => item.name) ?? [],
    [category],
  );

  const visibleBrandOptions = useMemo(() => {
    const search = brandSearch.trim().toLocaleLowerCase();
    return brandOptions
      .filter((brand) => brand !== selectedBrand)
      .filter((brand) => !search || brand.toLocaleLowerCase().includes(search))
      .slice(0, 12);
  }, [brandOptions, brandSearch, selectedBrand]);

  const importStats = useMemo(() => summarizeImportedAdjustmentRows(importedRows), [importedRows]);
  const workingRows = useMemo(() => importedRows.filter((row) => !importedRowNeedsReview(row)), [importedRows]);
  const reviewRows = useMemo(() => importedRows.filter(importedRowNeedsReview), [importedRows]);
  const missingDrafts = useMemo(() => groupMissingCatalogProducts(importedRows), [importedRows]);
  const visibleMissingDrafts = useMemo(() => missingDrafts.slice(0, REVIEW_LIST_LIMIT), [missingDrafts]);

  useEffect(() => {
    if (visibleMissingDrafts.length === 0) {
      setClassifySuggestions({});
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    fetch('/api/admin/pricing-adjustments/classify-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        ...(selectedBrand ? { brand: selectedBrand } : {}),
        items: visibleMissingDrafts.map((item) => ({
          name: item.name,
          catalogNumber: item.catalogNumber,
          spec: item.spec,
        })),
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as {
          suggestions?: Array<{ catalogNumber: string; spec: string; ok: boolean; category: string | null; subcategory: string | null; type: string | null }>;
        };
        if (cancelled || !response.ok || !Array.isArray(data.suggestions)) return;
        const next: Record<string, string> = {};
        for (const item of data.suggestions) {
          next[catalogItemKey(item.catalogNumber, item.spec)] = item.ok
            ? `${item.category} / ${item.subcategory}${item.type ? ` / ${item.type}` : ''}`
            : '需备用分类';
        }
        setClassifySuggestions(next);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setClassifySuggestions({});
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedBrand, visibleMissingDrafts]);
  const importTotalPages = Math.max(1, Math.ceil(workingRows.length / PAGE_SIZE));
  const safeImportPage = Math.min(importPage, importTotalPages);
  const visibleRows = workingRows.slice((safeImportPage - 1) * PAGE_SIZE, safeImportPage * PAGE_SIZE);
  const numericAmount = Number(amount);
  const fileMode = adjustmentMode === 'file';
  const appliedKeySet = useMemo(() => new Set(appliedCatalogKeys), [appliedCatalogKeys]);
  const pendingWriteCount = useMemo(() => importedRows.filter((row) => {
    if (row.status !== 'ready' && row.status !== 'warning') return false;
    return !appliedKeySet.has(catalogItemKey(row.catalogNumber, row.spec));
  }).length, [appliedKeySet, importedRows]);
  const previewReadiness = getPricingPreviewReadiness({
    brand: selectedBrand,
    scope: scopeMode,
    category,
    mode: adjustmentMode,
    amount,
    reason,
    rows: importedRows.filter((row) => !(
      (row.status === 'ready' || row.status === 'warning')
      && appliedKeySet.has(catalogItemKey(row.catalogNumber, row.spec))
    )),
  });
  const canWriteFromFile = previewReadiness.canWriteFromFile;
  const canPreview = previewReadiness.ok;
  const canOpenPreview = canPreview || (scopeMode === 'catalog' && importedRows.length > 0);
  const missingPreviewRequirements = previewReadiness.missing;
  const effectiveReason = previewReadiness.effectiveReason;
  const canConfirmApply = previewResult != null && !previewLoading && (
    (previewResult.changeCount ?? 0) > 0
    || ((previewResult.skippedUnchangedCount ?? 0) > 0 && (previewResult.matchedCount ?? 0) > 0)
  );

  async function rematchImportedRows(rows: ImportedAdjustmentRow[]): Promise<ImportedAdjustmentRow[]> {
    const matchable = rows.filter((row) => row.status === 'ready' || row.status === 'warning' || importedRowIsMissing(row));
    if (matchable.length === 0) return rows;
    const response = await fetch('/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(selectedBrand ? { brand: selectedBrand } : {}),
        catalogItems: matchable.map(toCatalogMatchItem),
      }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string; matches?: CatalogMatchResult[] };
    if (!response.ok || !Array.isArray(data.matches)) {
      throw new Error(typeof data.error === 'string' ? data.error : '商品匹配失败，预览时会再次核对货号。');
    }
    return applyCatalogMatchResults(rows, data.matches);
  }

  function decideReviewRow(row: ImportedAdjustmentRow, decision: { action: 'confirm'; brand?: string } | { action: 'skip' }) {
    setImportedRows((current) => applyImportedReviewDecision(current, row, decision));
    setApplyMessage('');
  }

  function confirmReviewRow(row: ImportedAdjustmentRow, brand?: string) {
    if (reviewRowNeedsBrandChoice(row) && !brand?.trim()) return;
    decideReviewRow(row, { action: 'confirm', brand });
  }

  function skipReviewRow(row: ImportedAdjustmentRow) {
    decideReviewRow(row, { action: 'skip' });
  }

  function confirmRemainingNameConflicts() {
    setImportedRows((current) => confirmNameConflictReviewRows(current));
    setApplyMessage('');
  }

  function adjustmentPayload(token?: string, rows: ImportedAdjustmentRow[] = importedRows, reasonText: string = effectiveReason) {
    const usableRows = rows.filter((row) => (
      (row.status === 'ready' || row.status === 'warning')
      && !appliedKeySet.has(catalogItemKey(row.catalogNumber, row.spec))
    ));
    return {
      brand: selectedBrand,
      scope: scopeMode,
      category: scopeMode === 'category' ? category : undefined,
      subcategory: scopeMode === 'category' && subcategory ? subcategory : undefined,
      catalogNumbers: scopeMode === 'catalog' && !fileMode
        ? usableRows.map((row) => row.catalogNumber)
        : undefined,
      catalogItems: scopeMode === 'catalog'
        ? (fileMode
          ? usableRows.filter(importedRowHasFilePrices).map(toCatalogPriceItem)
          : usableRows.map(toCatalogMatchItem))
        : undefined,
      priceField,
      mode: adjustmentMode,
      direction,
      amount: fileMode ? 0 : numericAmount,
      includeVariants: fileMode ? false : includeVariants,
      reason: reasonText,
      ...(token ? { stepUpToken: token } : {}),
    };
  }

  async function generatePreview(token?: string, allowMfaStepUp = true) {
    if (previewLoading && allowMfaStepUp) return;
    const generation = ++previewGenerationRef.current;
    const previewStillCurrent = () => generation === previewGenerationRef.current;
    setPreviewLoading(true);
    setPreviewError('');
    setApplyMessage('');
    previewPayloadRef.current = null;
    setPreviewResult(null);
    setPreviewVisible(true);
    try {
      let rows = importedRows;
      if (scopeMode === 'catalog' && importedRowsNeedCatalogRematch(rows)) {
        try {
          rows = await rematchImportedRows(rows);
          if (!previewStillCurrent()) return;
          setImportedRows(rows);
        } catch (error) {
          if (!previewStillCurrent()) return;
          setPreviewError(error instanceof Error ? error.message : '商品匹配失败，请稍后重试。');
          return;
        }
      }

      const readiness = getPricingPreviewReadiness({
        brand: selectedBrand,
        scope: scopeMode,
        category,
        mode: adjustmentMode,
        amount,
        reason,
        rows: rows.filter((row) => !(
          (row.status === 'ready' || row.status === 'warning')
          && appliedKeySet.has(catalogItemKey(row.catalogNumber, row.spec))
        )),
      });
      if (!readiness.ok) {
        if (!previewStillCurrent()) return;
        const unmatchedCount = rows.filter(importedRowIsMissing).length;
        setPreviewError(unmatchedCount > 0
          ? `还有 ${unmatchedCount.toLocaleString('zh-CN')} 个货号未入库，请先在上方导入后再生成预览。`
          : (readiness.missing.join('、') || '还不能生成预览'));
        return;
      }

      const payload = adjustmentPayload(token, rows, readiness.effectiveReason);
      const response = await fetch('/api/admin/pricing-adjustments/preview', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data: { error?: string; preview?: PreviewResult } = {};
      try {
        data = text ? JSON.parse(text) as { error?: string; preview?: PreviewResult } : {};
      } catch {
        data = {};
      }
      if (!previewStillCurrent()) return;
      if (allowMfaStepUp && isAdminMfaStepUpResponse(response.status, data.error)) {
        await beginMfaStepUp(async (grantToken) => {
          await generatePreview(grantToken, false);
        });
        return;
      }
      if (!response.ok) {
        setPreviewError(pricingActionError(data.error, '生成调价预览失败'));
        return;
      }
      if (!data.preview) {
        const looksLikeJson = text.trim().startsWith('{') || text.trim().startsWith('[');
        const blockedByGuard = /宝塔WAF|缓冲区溢出|传递的参数超过/.test(text);
        setPreviewError(pricingActionError(
          data.error,
          blockedByGuard
            ? '表格内容较大，安全防护拦截了本次预览。请把表格拆成更小的批次后再生成。'
            : looksLikeJson
              ? '预览没有返回可用结果，请拆分表格后重试'
              : '预览结果无法读取，请刷新页面后重新生成。',
        ));
        return;
      }
      const { stepUpToken: _stepUpToken, ...frozen } = payload;
      previewPayloadRef.current = frozen;
      setPreviewResult(data.preview);
      setPreviewVisible(true);
    } catch {
      if (!previewStillCurrent()) return;
      setPreviewVisible(true);
      setPreviewResult(null);
      setPreviewError('生成调价预览失败，请稍后重试');
    } finally {
      if (previewStillCurrent()) setPreviewLoading(false);
    }
  }

  async function applyAdjustment(token?: string, allowMfaStepUp = true) {
    const frozen = previewPayloadRef.current;
    if (!previewResult || !frozen || previewLoading || (applyLoading && allowMfaStepUp)) return;
    setApplyLoading(true);
    setApplyMessage('');
    setPreviewError('');
    try {
      const response = await fetch('/api/admin/pricing-adjustments/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...frozen, ...(token ? { stepUpToken: token } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; result?: PreviewResult & { updatedCount: number } };
      if (allowMfaStepUp && isAdminMfaStepUpResponse(response.status, data.error)) {
        await beginMfaStepUp(async (grantToken) => {
          await applyAdjustment(grantToken, false);
        });
        return;
      }
      if (!response.ok) {
        setPreviewError(pricingActionError(data.error, '执行调价失败'));
        return;
      }
      const updatedCount = data.result?.updatedCount ?? 0;
      const skippedUnchanged = data.result?.skippedUnchangedCount ?? 0;
      const writtenKeys = [
        ...((frozen.catalogItems as Array<{ catalogNumber?: string; spec?: string }> | undefined) ?? [])
          .map((item) => catalogItemKey(item.catalogNumber ?? '', item.spec ?? '')),
        ...((frozen.catalogNumbers as string[] | undefined) ?? []).map((catalogNumber) => catalogItemKey(catalogNumber, '')),
      ].filter(Boolean);
      if (writtenKeys.length > 0) {
        setAppliedCatalogKeys((current) => [...new Set([...current, ...writtenKeys])]);
      }
      setPreviewResult(data.result ?? previewResult);
      setApplyMessage(updatedCount > 0
        ? `已更新 ${updatedCount.toLocaleString('zh-CN')} 条价格${skippedUnchanged > 0 ? `，另有 ${skippedUnchanged.toLocaleString('zh-CN')} 条匹配后价格未变` : ''}`
        : '价格已与本次预览一致，没有需要改写的条目。');
    } catch {
      setPreviewError('执行调价失败，请稍后重试');
    } finally {
      setApplyLoading(false);
    }
  }

  async function importMissingProducts(token?: string, allowMfaStepUp = true) {
    if ((createLoading && allowMfaStepUp) || missingDrafts.length === 0) return;
    const fallbackBrand = selectedBrand.trim();
    if (missingDrafts.some((draft) => !(draft.brand.trim() || fallbackBrand))) {
      setImportError('导入新商品需要品牌。请选择品牌，或在表格中填写品牌列。');
      return;
    }
    setCreateLoading(true);
    setImportError('');
    setCreateMessage('');
    try {
      const response = await fetch('/api/admin/pricing-adjustments/create-missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(fallbackBrand ? { brand: fallbackBrand } : {}),
          autoClassify: true,
          ...(category ? { category } : {}),
          ...(subcategory ? { subcategory } : {}),
          drafts: missingDrafts,
          ...(token ? { stepUpToken: token } : {}),
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        result?: {
          createdCount: number;
          skippedCount: number;
          classifiedCount?: number;
          fallbackCount?: number;
          unclassifiedCatalogs?: string[];
          createdCatalogs: string[];
        };
      };
      if (allowMfaStepUp && isAdminMfaStepUpResponse(response.status, data.error)) {
        await beginMfaStepUp(async (grantToken) => {
          await importMissingProducts(grantToken, false);
        });
        return;
      }
      if (!response.ok || !data.result) {
        setImportError(typeof data.error === 'string' ? data.error : '导入商品失败');
        return;
      }
      const reopened = reopenMissingCatalogRows(importedRows, data.result.createdCatalogs);
      const rematched = await rematchImportedRows(reopened);
      setImportedRows(rematched);
      invalidatePreview();
      setCreateMessage(`已导入 ${data.result.createdCount.toLocaleString('zh-CN')} 个商品${data.result.classifiedCount ? `，其中 ${data.result.classifiedCount.toLocaleString('zh-CN')} 个按名称归入现有分类` : ''}${data.result.fallbackCount ? `，${data.result.fallbackCount.toLocaleString('zh-CN')} 个使用备用分类` : ''}${data.result.skippedCount > 0 ? `，跳过 ${data.result.skippedCount.toLocaleString('zh-CN')} 个` : ''}。`);
    } catch {
      setImportError('导入商品失败，请稍后重试。');
    } finally {
      setCreateLoading(false);
    }
  }

  async function parseWorkbook(file: File) {
    setImportError('');
    invalidatePreview();
    if (file.size > MAX_FILE_SIZE) {
      setImportError('文件超过 20 MB，请拆分后重新导入。');
      return;
    }
    setImporting(true);
    try {
      const extension = file.name.trim().toLowerCase().split('.').pop();
      let table: unknown[][];
      if (extension === 'csv') {
        table = parseCsvRows(await file.text());
      } else if (extension === 'xlsx') {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.default.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        if (workbook.worksheets.length !== 1) throw new Error('仅支持包含一个工作表的文件。');
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('表格中没有可读取的工作表。');
        table = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const values = row.values;
          table.push((Array.isArray(values) ? values.slice(1) : []).map(normalizeSpreadsheetCell));
        });
      } else {
        throw new Error('仅支持 XLSX 或 CSV 文件。');
      }
      const parsed = parsePricingAdjustmentImport(table, { selectedBrand, maxRows: MAX_IMPORT_ROWS });
      if (!parsed.ok) throw new Error(parsed.error);
      setScopeMode('catalog');
      setCreateMessage('');
      setAppliedCatalogKeys([]);
      setReviewBrandChoices({});
      let rows = parsed.rows;
      try {
        rows = await rematchImportedRows(rows);
      } catch (error) {
        setImportError(error instanceof Error ? error.message : '商品匹配失败，预览时会再次核对货号。');
      }
      setImportedRows(rows);
      setFileName(file.name);
      setImportPage(1);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (rows.some((row) => importedRowHasFilePrices(row) && (row.status === 'ready' || row.status === 'warning' || importedRowIsMissing(row)))) {
        setAdjustmentMode('file');
        setReason((current) => current.trim() || DEFAULT_FILE_ADJUSTMENT_REASON);
      } else {
        setAdjustmentMode((mode) => (mode === 'file' ? 'percent' : mode));
      }
    } catch (error) {
      setFileName('');
      setImportedRows([]);
      setImportError(error instanceof Error ? error.message : '表格读取失败，请检查文件格式。');
    } finally {
      setImporting(false);
    }
  }

  async function downloadTemplate() {
    if (templateDownloading) return;
    setTemplateDownloading(true);
    setImportError('');
    try {
      const response = await fetch('/api/admin/pricing-adjustments/template', { cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 401) {
          setImportError('登录已失效，请重新登录后台后再下载模板。');
        } else if (response.status === 403) {
          setImportError('当前账号没有调价权限。');
        } else if (response.status === 404) {
          setImportError('服务器上未找到调价模板。');
        } else {
          setImportError(typeof data.error === 'string' ? data.error : '模板下载失败，请稍后重试。');
        }
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '商品集中调价导入模板.xlsx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setImportError('模板下载失败，请稍后重试。');
    } finally {
      setTemplateDownloading(false);
    }
  }

  function selectBrand(value: string) {
    const brand = value.trim();
    if (!brand) return;
    setSelectedBrand(brand);
    setBrandSearch('');
    setCategory('');
    setSubcategory('');
    invalidatePreview();
  }

  function clearImport() {
    setFileName('');
    setImportedRows([]);
    setImportError('');
    setImportPage(1);
    setAppliedCatalogKeys([]);
    setReviewBrandChoices({});
    invalidatePreview();
    setCreateMessage('');
    setAdjustmentMode((mode) => (mode === 'file' ? 'percent' : mode));
    setReason((current) => (current === DEFAULT_FILE_ADJUSTMENT_REASON ? '' : current));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const scopeSummary = [
    selectedBrand || (scopeMode === 'catalog' ? '按货号' : '全部品牌'),
    scopeMode === 'category' ? (category || '全部分类') : '',
    scopeMode === 'category' ? subcategory : '',
  ].filter(Boolean).join(' / ')
    || (scopeMode === 'catalog' && fileName
      ? `${fileName}，${importStats.matched.toLocaleString('zh-CN')} 条已匹配${importStats.pending > 0 ? `，${importStats.pending.toLocaleString('zh-CN')} 条待核对` : ''}`
      : '尚未完成范围选择');

  return (
    <div className="space-y-5 pb-6">
      <header>
        <p className="text-xs font-medium tracking-wide text-gray-500">产品管理</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">集中调价</h1>
      </header>

      <section className={`overflow-hidden rounded-xl ${uiSurfaces.panel}`}>
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">1</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">选择调价范围</h2>
              <p className="text-xs text-gray-500">每个批次使用一种范围，预览后再执行。</p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
            <div className="flex items-start gap-3">
              <Tag size={19} className="mt-0.5 shrink-0 text-brand-700" />
              <div className="min-w-0 flex-1">
                <label htmlFor="brand-search" className="text-sm font-semibold text-gray-900">品牌（可选）</label>
                <p className="mt-1 text-xs text-gray-600">按表格调价时可不选，系统按货号匹配。按产品线调价时可不选品牌（全品牌），也可只选品牌、分类或子分类。</p>
                <div className="relative mt-3">
                  <div className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
                    {selectedBrand && <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{selectedBrand}<button type="button" onClick={() => { setSelectedBrand(''); setCategory(''); setSubcategory(''); invalidatePreview(); }} aria-label={`移除${selectedBrand}`}><X size={13} /></button></span>}
                    <input
                      id="brand-search"
                      value={brandSearch}
                      onChange={(event) => setBrandSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); selectBrand(brandSearch); }
                      }}
                      placeholder={selectedBrand ? '更换品牌' : '搜索或输入品牌，留空表示不限品牌'}
                      className="min-w-48 flex-1 border-0 bg-transparent px-1 py-1 text-sm text-gray-900 outline-none"
                    />
                  </div>
                  {brandSearch && visibleBrandOptions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 grid gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-sm sm:grid-cols-2">
                      {visibleBrandOptions.map((brand) => <button key={brand} type="button" onClick={() => selectBrand(brand)} className="rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">{brand}</button>)}
                    </div>
                  )}
                </div>
              </div>
              {selectedBrand && <Check size={18} className="mt-0.5 shrink-0 text-brand-700" />}
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {([
              ['category', Layers3, '按产品线', '可选品牌、分类、子分类；都不选则按全站商品调价'],
                  ['catalog', FileSpreadsheet, '指定货号', '导入 XLSX 或 CSV，按表格货号匹配'],
            ] as const).map(([value, Icon, label, description]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setScopeMode(value);
                  if (value === 'category') {
                    setAdjustmentMode((mode) => (mode === 'file' ? 'percent' : mode));
                    setReason((current) => (current === DEFAULT_FILE_ADJUSTMENT_REASON ? '' : current));
                  }
                  invalidatePreview();
                }}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${scopeMode === value ? 'border-brand-400 bg-brand-50/70' : 'border-gray-200 bg-white hover:border-brand-200'}`}
              >
                <Icon size={19} className={scopeMode === value ? 'text-brand-700' : 'text-gray-500'} />
                <span>
                  <span className="block text-sm font-semibold text-gray-900">{label}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{description}</span>
                </span>
                {scopeMode === value && <Check size={16} className="ml-auto text-brand-700" />}
              </button>
            ))}
          </div>

          {scopeMode === 'category' && (
            <div className="mt-5 grid max-w-3xl gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-800">
                分类
                <select value={category} onChange={(event) => { setCategory(event.target.value); setSubcategory(''); invalidatePreview(); }} className={`mt-2 w-full ${uiSurfaces.input}`}>
                  <option value="">全部分类</option>
                  {productCategories.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-gray-800">
                子分类
                <select value={subcategory} onChange={(event) => { setSubcategory(event.target.value); invalidatePreview(); }} disabled={!category} className={`mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50 ${uiSurfaces.input}`}>
                  <option value="">全部子分类</option>
                  {subcategoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
          )}

          {scopeMode === 'catalog' && (
            <div className="mt-5 space-y-4">
              <div
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false); }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void parseWorkbook(file);
                }}
                className={`rounded-xl border border-dashed px-5 py-7 text-center transition ${dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-gray-50/60'}`}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseWorkbook(file); }} />
                <Upload size={24} className="mx-auto text-gray-500" />
                <p className="mt-3 text-sm font-semibold text-gray-900">拖入调价表格，或选择文件</p>
                <p className="mt-1 text-xs text-gray-500">支持 XLSX、CSV，单次最多 50,000 行、20 MB</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing} className={`min-h-10 px-4 text-sm font-medium ${uiSurfaces.buttonPrimary}`}>{importing ? '正在读取…' : '选择文件'}</button>
                  <button type="button" onClick={() => void downloadTemplate()} disabled={templateDownloading} className={`inline-flex min-h-10 items-center gap-2 px-4 text-sm font-medium ${uiSurfaces.buttonSecondary}`}><Download size={15} />{templateDownloading ? '正在下载…' : '下载模板'}</button>
                </div>
              </div>

              {importError && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert"><AlertCircle size={17} className="mt-0.5 shrink-0" />{importError}</div>}

              {fileName && (
                <div className="rounded-xl border border-gray-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{fileName}</p>
                      <p className="mt-0.5 text-xs text-gray-500">按货号匹配{selectedBrand ? `，当前限定品牌 ${selectedBrand}` : ''}。商品名仅用于核对。规格 2 至规格 5 以及目录价、市场价、促销价、进货价、最低成交价按列读取，空白价格保持原值。</p>
                    </div>
                    <button type="button" onClick={clearImport} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-100"><X size={14} />移除文件</button>
                  </div>

                  <div className="grid grid-cols-2 gap-px bg-gray-100 sm:grid-cols-4 lg:grid-cols-7">
                    {[
                      ['总行数', importStats.total],
                      ['已匹配', importStats.matched],
                      ['待核对', importStats.pending],
                      ['未匹配', importStats.unmatched],
                      ['待审核', importStats.review],
                      ['无效行', importStats.invalid],
                      ['重复行', importStats.duplicate],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="bg-white px-4 py-3">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className={`mt-1 text-lg font-semibold tabular-nums ${label === '待审核' && Number(value) > 0 ? 'text-amber-800' : 'text-gray-900'}`}>{Number(value).toLocaleString('zh-CN')}</p>
                      </div>
                    ))}
                  </div>
                  {importStats.pending > 0 && (
                    <p className="border-b border-gray-100 px-4 py-2 text-xs text-amber-800">有 {importStats.pending.toLocaleString('zh-CN')} 条尚未完成商品核对，生成预览时会再次匹配货号。</p>
                  )}

                  {workingRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1080px] text-sm">
                      <thead className="border-y border-gray-100 bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium">行</th>
                          <th className="px-4 py-2 text-left font-medium">商品名</th>
                          <th className="px-4 py-2 text-left font-medium">货号</th>
                          <th className="px-4 py-2 text-left font-medium">规格</th>
                          <th className="px-4 py-2 text-right font-medium">目录价</th>
                          <th className="px-4 py-2 text-right font-medium">市场价</th>
                          <th className="px-4 py-2 text-right font-medium">促销价</th>
                          <th className="px-4 py-2 text-right font-medium">进货价</th>
                          <th className="px-4 py-2 text-right font-medium">最低成交价</th>
                          <th className="px-4 py-2 text-left font-medium">检查结果</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visibleRows.map((row) => (
                          <tr key={`${row.rowNumber}-${row.catalogNumber}-${row.specIndex}-${row.spec}`} className={row.status === 'invalid' || row.status === 'duplicate' ? 'bg-red-50/40' : ''}>
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{row.rowNumber}</td>
                            <td className="px-4 py-2.5 text-gray-700">{row.name || '—'}</td>
                            <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900">{row.catalogNumber || '—'}</td>
                            <td className="px-4 py-2.5 text-gray-700">{row.spec || (row.specIndex === 1 ? '主规格' : '—')}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatPrice(row.originalPrice)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatPrice(row.price)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatPrice(row.promotionalPrice)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatPrice(row.costPrice)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatPrice(row.minimumSalePrice)}</td>
                            <td className="px-4 py-2.5"><span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${row.status === 'ready' ? 'bg-emerald-50 text-emerald-800' : row.status === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800'}`}>{row.note}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}

                  {workingRows.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
                      <span>第 {safeImportPage} / {importTotalPages} 页</span>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setImportPage((page) => Math.max(1, page - 1))} disabled={safeImportPage === 1} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40" aria-label="上一页"><ChevronLeft size={15} /></button>
                        <button type="button" onClick={() => setImportPage((page) => Math.min(importTotalPages, page + 1))} disabled={safeImportPage === importTotalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40" aria-label="下一页"><ChevronRight size={15} /></button>
                      </div>
                    </div>
                  )}

                  <ReviewWorkbench
                    title="待人工审核"
                    description="货号能对上，但商品名不一致，或同一货号对应多个品牌。本批预览已跳过这些货号。"
                    items={reviewRows}
                    brandChoices={reviewBrandChoices}
                    onBrandChoice={(key, brand) => setReviewBrandChoices((current) => ({ ...current, [key]: brand }))}
                    onConfirm={confirmReviewRow}
                    onSkip={skipReviewRow}
                    onConfirmNameConflicts={confirmRemainingNameConflicts}
                  />

                  {missingDrafts.length > 0 && (
                    <div className="border-t border-sky-100 bg-sky-50/40">
                      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-sky-950">库中没有这些商品</p>
                          <p className="mt-1 text-xs text-sky-900">共 {missingDrafts.length.toLocaleString('zh-CN')} 个货号可导入。分类按现行产品库结构根据商品名判定；判定不了的才使用备用分类。进货价只写入后台。表格未填品牌时，请先在上方选择品牌。</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="text-xs font-medium text-gray-800">
                            备用分类
                            <select value={category} onChange={(event) => { setCategory(event.target.value); setSubcategory(''); }} className={`mt-1 min-w-36 ${uiSurfaces.input}`}>
                              <option value="">不指定</option>
                              {productCategories.filter((item) => item.name !== '新产品').map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                            </select>
                          </label>
                          <label className="text-xs font-medium text-gray-800">
                            备用子分类
                            <select value={subcategory} onChange={(event) => setSubcategory(event.target.value)} disabled={!category} className={`mt-1 min-w-36 disabled:opacity-50 ${uiSurfaces.input}`}>
                              <option value="">不指定</option>
                              {subcategoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={createLoading}
                            onClick={() => void importMissingProducts()}
                            className={`inline-flex min-h-10 items-center gap-2 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${uiSurfaces.buttonPrimary}`}
                          >
                            {createLoading ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
                            {createLoading ? '正在导入…' : '导入这些商品'}
                          </button>
                        </div>
                      </div>
                      {createMessage && <p className="border-t border-sky-100 px-4 py-2 text-xs text-sky-900">{createMessage}</p>}
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-sm">
                          <thead className="border-y border-sky-100 bg-sky-50 text-xs text-sky-900">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium">商品名</th>
                              <th className="px-4 py-2 text-left font-medium">建议分类</th>
                              <th className="px-4 py-2 text-left font-medium">货号</th>
                              <th className="px-4 py-2 text-left font-medium">规格</th>
                              <th className="px-4 py-2 text-right font-medium">市场价</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-sky-100 bg-white">
                            {visibleMissingDrafts.map((item) => {
                              const suggestion = classifySuggestions[catalogItemKey(item.catalogNumber, item.spec)];
                              return (
                              <tr key={item.catalogNumber}>
                                <td className="px-4 py-2.5 text-gray-700">{item.name}</td>
                                <td className="px-4 py-2.5 text-xs text-gray-700">{suggestion || '判定中…'}</td>
                                <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900">{item.catalogNumber}</td>
                                <td className="px-4 py-2.5 text-gray-700">{item.spec || (item.variants.length > 0 ? `主规格 + ${item.variants.length.toLocaleString('zh-CN')} 个规格` : '主规格')}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatPrice(item.price)}</td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {createMessage && missingDrafts.length === 0 && (
                    <p className="border-t border-emerald-100 bg-emerald-50/60 px-4 py-2.5 text-xs text-emerald-900">{createMessage}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className={`rounded-xl ${uiSurfaces.panel}`}>
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">2</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{canWriteFromFile ? '调价规则（可选）' : '设置调价方式'}</h2>
              <p className="text-xs text-gray-500">
                {canWriteFromFile
                  ? '表格已含价格，可跳过本步，直接到第 3 步按表格更新；也可以按百分比、金额或统一价再调一次。'
                  : scopeMode === 'catalog' && importedRows.length > 0
                    ? '表格没有可写入的价格，请设置调价规则。'
                    : '每个批次只修改一个价格字段。'}
              </p>
            </div>
          </div>
        </div>
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1.2fr_1fr]">
          {canWriteFromFile && (
            <div className="lg:col-span-2">
              <p className="text-sm font-medium text-gray-800">写入方式</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => { setAdjustmentMode('file'); invalidatePreview(); }}
                  className={`rounded-xl border px-4 py-3 text-left ${fileMode ? 'border-brand-400 bg-brand-50/70' : 'border-gray-200 bg-white'}`}
                >
                  <span className="block text-sm font-semibold text-gray-900">按表格写入价格</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-500">使用表内已填价格更新，空白单元格保持原值。</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setAdjustmentMode((mode) => (mode === 'file' ? 'percent' : mode)); invalidatePreview(); }}
                  className={`rounded-xl border px-4 py-3 text-left ${!fileMode ? 'border-brand-400 bg-brand-50/70' : 'border-gray-200 bg-white'}`}
                >
                  <span className="block text-sm font-semibold text-gray-900">按规则再调价</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-500">忽略表内价格，按百分比、金额或统一价调整已匹配货号。</span>
                </button>
              </div>
            </div>
          )}

          {!fileMode && (
          <div>
            <p className="text-sm font-medium text-gray-800">价格字段</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {PRICE_FIELDS.map((field) => (
                <button key={field.value} type="button" onClick={() => { setPriceField(field.value); invalidatePreview(); }} className={`rounded-xl border px-3 py-3 text-left ${priceField === field.value ? 'border-brand-400 bg-brand-50/70' : 'border-gray-200 bg-white'}`}>
                  <span className="block text-sm font-semibold text-gray-900">{field.label}</span><span className="mt-1 block text-xs leading-5 text-gray-500">{field.description}</span>
                </button>
              ))}
            </div>
          </div>
          )}

          <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-1 ${fileMode ? 'lg:col-span-2' : ''}`}>
            {fileMode ? (
              <p className="text-sm leading-6 text-gray-600">写入表格中已填写的目录价、市场价、促销价、进货价和最低成交价。规格 2 至规格 5 按规格名称或货号匹配包装。空白单元格不改原值。</p>
            ) : (
              <>
            <label className="text-sm font-medium text-gray-800">
              调价方式
              <select value={adjustmentMode} onChange={(event) => { setAdjustmentMode(event.target.value as AdjustmentMode); invalidatePreview(); }} className={`mt-2 w-full ${uiSurfaces.input}`}>
                <option value="percent">按百分比调整</option>
                <option value="amount">按固定金额调整</option>
                <option value="set">设置统一价格</option>
              </select>
            </label>
            {adjustmentMode !== 'set' && (
              <div>
                <p className="text-sm font-medium text-gray-800">调整方向</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setDirection('increase'); invalidatePreview(); }} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium ${direction === 'increase' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600'}`}><ArrowUp size={15} />上调</button>
                  <button type="button" onClick={() => { setDirection('decrease'); invalidatePreview(); }} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium ${direction === 'decrease' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-600'}`}><ArrowDown size={15} />下调</button>
                </div>
              </div>
            )}
            <label className="text-sm font-medium text-gray-800">
              {adjustmentMode === 'percent' ? '调整比例' : adjustmentMode === 'amount' ? '调整金额' : '统一价格'}
              <div className="relative mt-2">
                <input type="number" min="0" step={adjustmentMode === 'percent' ? '0.1' : '0.01'} value={amount} onChange={(event) => { setAmount(event.target.value); invalidatePreview(); }} placeholder={adjustmentMode === 'percent' ? '例如 5' : '例如 100.00'} className={`w-full pr-12 ${uiSurfaces.input}`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">{adjustmentMode === 'percent' ? '%' : '元'}</span>
              </div>
            </label>
              </>
            )}
          </div>

          {!fileMode && (
            <div className="lg:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={includeVariants} onChange={(event) => { setIncludeVariants(event.target.checked); invalidatePreview(); }} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />同时调整商品规格价格</label>
            </div>
          )}
        </div>
      </section>

      <section className={`rounded-xl ${uiSurfaces.panel}`}>
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">3</span><h2 className="text-base font-semibold text-gray-900">预览并确认</h2></div>
              <p className="mt-2 text-sm text-gray-500">预览会检查匹配商品、价格边界和无效货号，不会修改数据。</p>
              <label className="mt-4 block text-sm font-medium text-gray-800">
                调价原因
                <input
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (!previewLoading) invalidatePreview();
                  }}
                  maxLength={200}
                  placeholder={fileMode ? DEFAULT_FILE_ADJUSTMENT_REASON : '例如：供应商年度价格调整'}
                  className={`mt-2 w-full max-w-xl ${uiSurfaces.input}`}
                />
              </label>
              {!canPreview && (
                <p className="mt-2 text-xs text-amber-700">
                  {reviewRows.length > 0 && pendingWriteCount === 0
                    ? '还有待审核货号。确认同一商品或跳过后再生成预览。'
                    : importStats.unmatched > 0
                      ? '库中没有对应商品时，可先在上方导入，或查看未匹配列表。'
                      : `还需：${missingPreviewRequirements.join('、')}`}
                </p>
              )}
            </div>
            <button type="button" disabled={!canOpenPreview || previewLoading} onClick={() => void generatePreview()} className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${uiSurfaces.buttonPrimary}`}>
              {previewLoading ? <Loader2 size={17} className="animate-spin" /> : <PackageSearch size={17} />}
              {previewLoading ? '正在生成预览' : '生成调价预览'}
            </button>
          </div>
        </div>

        {previewVisible && (
          <div className="border-t border-gray-100 px-4 py-5 sm:px-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"><p className="text-xs text-gray-500">调价范围</p><p className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900">{scopeSummary}</p></div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"><p className="text-xs text-gray-500">价格字段</p><p className="mt-1 text-sm font-semibold text-gray-900">{fileMode ? '表格中已填写的价格' : PRICE_FIELDS.find((field) => field.value === priceField)?.label}</p></div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"><p className="text-xs text-gray-500">调整内容</p><p className="mt-1 text-sm font-semibold text-gray-900">{fileMode ? '按表格写入' : adjustmentMode === 'set' ? `设置为 ${numericAmount} 元` : `${direction === 'increase' ? '上调' : '下调'} ${numericAmount}${adjustmentMode === 'percent' ? '%' : ' 元'}`}</p></div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"><p className="text-xs text-gray-500">将更新</p><p className="mt-1 text-sm font-semibold text-gray-900">{previewResult ? `${previewResult.changeCount.toLocaleString('zh-CN')} 条价格` : '等待预览结果'}</p></div>
            </div>

            {previewError && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert"><AlertCircle size={17} className="mt-0.5 shrink-0" />{previewError}</div>}
            {applyMessage && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">{applyMessage}</div>}

            {previewResult && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">匹配商品</p><p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{previewResult.matchedCount.toLocaleString('zh-CN')}</p></div>
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">本次写入</p><p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{previewResult.changeCount.toLocaleString('zh-CN')}</p></div>
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">价格未变</p><p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{previewResult.skippedUnchangedCount.toLocaleString('zh-CN')}</p></div>
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">缺价格跳过</p><p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{previewResult.skippedMissingCount.toLocaleString('zh-CN')}</p></div>
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">跳过询价</p><p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{previewResult.skippedInquiryCount.toLocaleString('zh-CN')}</p></div>
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">按最低成交价处理</p><p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{previewResult.flooredCount.toLocaleString('zh-CN')}</p></div>
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">未匹配货号</p><p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{previewResult.unmatchedCatalogs.length.toLocaleString('zh-CN')}</p></div>
                <div className="rounded-xl border border-gray-200 px-4 py-3"><p className="text-xs text-gray-500">待人工审核</p><p className={`mt-1 text-sm font-semibold tabular-nums ${reviewRows.length > 0 ? 'text-amber-800' : 'text-gray-900'}`}>{reviewRows.length.toLocaleString('zh-CN')}</p></div>
              </div>
            )}

            {previewResult && previewResult.samples.length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">品牌</th>
                      <th className="px-4 py-2 text-left font-medium">货号</th>
                      <th className="px-4 py-2 text-left font-medium">名称</th>
                      <th className="px-4 py-2 text-left font-medium">字段</th>
                      <th className="px-4 py-2 text-right font-medium">原价格</th>
                      <th className="px-4 py-2 text-right font-medium">预计价格</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewResult.samples.map((row) => (
                      <tr key={`${row.productId}-${row.variantId ?? 'product'}-${row.fieldLabel ?? priceField}`}>
                        <td className="px-4 py-2.5 text-gray-700">{row.brand}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-900">{row.catalogNumber}</td>
                        <td className="px-4 py-2.5 text-gray-700">{row.name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{row.fieldLabel || PRICE_FIELDS.find((field) => field.value === priceField)?.label}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{formatPrice(row.currentPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">{formatPrice(row.nextPrice)}{row.floored ? <span className="ml-1 text-xs font-medium text-amber-700">已按最低成交价</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {previewResult && previewResult.unmatchedCatalogs.length > 0 && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
                <p>有 {previewResult.unmatchedCatalogs.length.toLocaleString('zh-CN')} 个货号在库中不存在。可回到上方表格，选择分类后导入这些商品，再生成调价预览。</p>
                <p className="mt-1 text-xs text-sky-800">未匹配货号：{previewResult.unmatchedCatalogs.slice(0, 12).join('、')}{previewResult.unmatchedCatalogs.length > 12 ? ' 等' : ''}</p>
              </div>
            )}

            {reviewRows.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-xl border border-amber-200">
                <ReviewWorkbench
                  title="待人工审核"
                  description="这些货号尚未写入。确认是同一商品后，再生成预览并执行，即可完成整批调价。"
                  items={reviewRows}
                  brandChoices={reviewBrandChoices}
                  onBrandChoice={(key, brand) => setReviewBrandChoices((current) => ({ ...current, [key]: brand }))}
                  onConfirm={confirmReviewRow}
                  onSkip={skipReviewRow}
                  onConfirmNameConflicts={confirmRemainingNameConflicts}
                />
                {pendingWriteCount > 0 && (
                  <div className="border-t border-amber-100 bg-white px-4 py-3">
                    <p className="text-xs text-amber-900">已确认 {pendingWriteCount.toLocaleString('zh-CN')} 条待写入货号。</p>
                    <button
                      type="button"
                      disabled={previewLoading}
                      onClick={() => void generatePreview()}
                      className={`mt-2 inline-flex min-h-10 items-center gap-2 px-4 text-sm font-medium disabled:opacity-50 ${uiSurfaces.buttonPrimary}`}
                    >
                      {previewLoading ? <Loader2 size={15} className="animate-spin" /> : <PackageSearch size={15} />}
                      为已确认货号生成预览
                    </button>
                  </div>
                )}
              </div>
            )}

            {previewResult && (
            <div className="mt-4 flex flex-col items-stretch gap-2 sm:items-end">
                {applyMessage ? (
                  <p className="text-xs text-gray-500">
                    本批次已经执行。
                    {reviewRows.length > 0 ? '下方待审核货号确认后，再生成预览并执行，即可完成整批调价。' : '调整范围或规则后请重新预览。'}
                  </p>
                ) : (previewResult.changeCount ?? 0) > 0 ? (
                  <p className="text-xs text-gray-500">将写入 {previewResult.changeCount.toLocaleString('zh-CN')} 条价格。</p>
                ) : previewResult.skippedUnchangedCount > 0 && previewResult.matchedCount > 0 ? (
                  <p className="text-xs text-gray-500">库中价格已与本次规则一致。确认执行后价格保持当前值。</p>
                ) : (
                  <p className="text-xs text-amber-800">
                    {previewResult.skippedInquiryCount > 0 && previewResult.skippedUnchangedCount === 0
                      ? `当前范围 ${previewResult.skippedInquiryCount.toLocaleString('zh-CN')} 条都是询价商品，没有公开售价，不能按比例或金额调整。如需写入公开售价，请把调价方式改为「设置统一价格」。`
                      : `当前范围内没有可更新的价格，已跳过询价 ${previewResult.skippedInquiryCount.toLocaleString('zh-CN')} 条、未变化 ${previewResult.skippedUnchangedCount.toLocaleString('zh-CN')} 条。`}
                  </p>
                )}
                <button
                  type="button"
                  disabled={!canConfirmApply || applyLoading || previewLoading || Boolean(applyMessage)}
                  onClick={() => void applyAdjustment()}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${uiSurfaces.buttonPrimary}`}
                >
                  {applyLoading ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
                  {applyLoading ? '正在执行' : '确认执行调价'}
                </button>
            </div>
            )}
          </div>
        )}
      </section>
      {mfaDialog}
    </div>
  );
}
