'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

import { Search, Eye, X, Plus, Trash2, SlidersHorizontal } from 'lucide-react';
import { productCategories } from '@/data/categories';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface AdminProduct {
  id: string;
  catalogNumber: string;
  name: string;
  brand: string;
  category?: string;
  subcategory?: string;
  spec?: string;
  price: number;
  originalPrice?: number;
  promotionalPrice?: number;
  costPrice?: number;
  minimumSalePrice?: number;
  inStock: boolean;
  promotion?: boolean;
  hazardous?: boolean;
  host?: string;
  applications?: string[];
  reactivity?: string[];
  type?: string;
  target?: string;
  subBrand?: string;

  // === P2-1: 生物医药专业字段 ===
  leadTime?: string;
  storageTemp?: string;
  storageBuffer?: string;
  expiryDate?: string;
  lotNumber?: string;
  cloneNumber?: string;
  purity?: string;
  molecularWeight?: number;
  isoelectricPoint?: number;
  concentration?: string;
  cofaUrl?: string;
  sdsUrl?: string;
  pmids?: string[];
  stockQuantity?: number;
  variants?: ProductVariant[];
  prices?: ProductPriceEntry[];
}

interface ProductPriceEntry {
  id: string;
  kind: string;
  amount: number;
  source?: string | null;
  createdAt: string;
}

interface ProductVariant {
  id?: string;
  catalogNumber: string;
  spec: string;
  price: number;
  originalPrice?: number | null;
  promotionalPrice?: number | null;
  costPrice?: number | null;
  minimumSalePrice?: number | null;
  packageType?: string | null;
  salesUnit?: string | null;
  baseQuantity?: number | null;
}

export default function AdminProductsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">产品管理</h1>
        </div>
        <Link href="/admin/pricing-adjustments" className={`inline-flex min-h-10 items-center gap-2 px-4 text-sm font-medium ${uiSurfaces.buttonPrimary}`}>
          <SlidersHorizontal size={16} />
          集中调价
        </Link>
      </div>
      <ProductsPanel />
    </div>
  );
}

function ProductsPanel() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: session, status } = useSession();

  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(null);
  const [editForm, setEditForm] = useState<Partial<AdminProduct>>({});
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(80);

  const categories = productCategories.map((category) => category.name);
  const brands = ['贤至生物', 'Fisher BioReagents', 'Thermo Fisher', 'Abcam', 'Sigma-Aldrich', 'Fisher', 'CST'];

  // Fetch products from API
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProducts(true);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (quickFilter) params.set('quick', quickFilter);
        params.set('take', '1000');
        const res = await fetch(`/api/admin/products?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setProducts(data.products || []);
        setFilteredTotal(data.stats?.filteredProducts ?? data.products?.length ?? 0);
        setPage(1);
      } catch (err) {
        console.error('[admin/products] fetch failed:', err);
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [search, quickFilter]);

  const filtered = products;

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const handleEdit = async (product: AdminProduct) => {
    setSelectedProduct(product);
    setEditForm({ ...product });
    const response = await fetch(`/api/admin/products/${product.id}`);
    if (response.ok) {
      const data = await response.json();
      setEditForm(data.product as AdminProduct);
    }
  };

  const handleSave = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, id: selectedProduct.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || '保存失败');
      }
      const saved = data.product as AdminProduct;
      setProducts((current) => current.map((p) => (p.id === saved.id ? saved : p)));
      setSelectedProduct(null);
      alert('产品信息已保存');
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm('确定删除该产品？')) return;
    const updated = products.filter(p => p.id !== id);
    setProducts(updated);
    (window as { __ADMIN_PRODUCTS__?: AdminProduct[] }).__ADMIN_PRODUCTS__ = updated;
    if (selectedProduct?.id === id) setSelectedProduct(null);
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 ${uiSurfaces.toolbar}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索产品名称、货号、品牌..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className={`w-64 py-2 pl-9 pr-4 text-sm ${uiSurfaces.input}`}
            />
          </div>
          {[
            ['zero-price-promo', '目录价为 0'],
            ['promotion', '全部促销'],
            ['hazardous', '仅危化品'],
            ['', '全部产品'],
          ].map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => setQuickFilter(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                quickFilter === value
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <label className="inline-flex items-center gap-2">
            每页
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className={`px-2 py-1 text-sm ${uiSurfaces.input}`}
            >
              <option value={80}>80</option>
              <option value={120}>120</option>
              <option value={200}>200</option>
            </select>
          </label>
          <span>{filtered.length} / {filteredTotal || filtered.length}</span>
        </div>
      </div>

      <div className={`overflow-hidden rounded-2xl ${uiSurfaces.panel}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-semibold text-gray-700">货号</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">产品名称</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">品牌</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">分类</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">规格</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">目录价</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">市场价</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">促销价</th>
                <th className="text-left px-3 py-2 font-semibold text-purple-700">进货价</th>
                <th className="text-left px-3 py-2 font-semibold text-red-700">最低成交价</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">库存</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">促销</th>
                <th className="text-left px-3 py-2 font-semibold text-red-700">危化</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(product => (
                <tr key={product.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono text-gray-600">{product.catalogNumber || product.id}</td>
                  <td className="px-3 py-2 max-w-[320px] truncate font-medium text-gray-900" title={product.name}>{product.name}</td>
                  <td className="px-3 py-2 text-gray-700">{product.brand}</td>
                  <td className="px-3 py-2 text-gray-700">{product.category}</td>
                  <td className="px-3 py-2 text-gray-700">{product.spec}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">
                    {product.originalPrice ? `¥${product.originalPrice.toLocaleString()}` : <span className="text-orange-600">未填</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {product.price > 0 ? `¥${product.price.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-3 py-2 font-semibold text-brand-700">
                    {product.promotionalPrice ? `¥${product.promotionalPrice.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-3 py-2 font-semibold text-purple-700">
                    {product.costPrice ? `¥${product.costPrice.toLocaleString()}` : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-3 py-2 font-semibold text-red-700">
                    {product.minimumSalePrice != null ? `¥${product.minimumSalePrice.toLocaleString()}` : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${product.inStock ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {product.inStock ? '有货' : '缺货'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {product.promotion && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        促销
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {product.hazardous ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        危化
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleEdit(product)} className="text-brand-600 hover:text-brand-700 text-xs flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" /> 编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadingProducts && <div className="text-center py-12 text-gray-400">正在加载产品...</div>}
          {!loadingProducts && paginated.length === 0 && <div className="text-center py-12 text-gray-400">暂无产品数据</div>}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="px-3 py-1 border border-gray-200 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50">上一页</button>
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="px-3 py-1 border border-gray-200 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50">下一页</button>
        </div>
      )}

      {selectedProduct && (
        <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-slate-900/35 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))] backdrop-blur-[1px]">
          <div className="my-auto w-full max-w-2xl max-h-[min(90vh,calc(100dvh-var(--site-header-height)-var(--site-header-gap)-2rem))] overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
              <h3 className="font-semibold text-gray-900">编辑产品</h3>
              <button onClick={() => setSelectedProduct(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">货号</label>
                  <input value={editForm.catalogNumber || ''} onChange={e => setEditForm(editForm => ({...editForm, catalogNumber: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">品牌</label>
                  <select value={editForm.brand || ''} onChange={e => setEditForm(editForm => ({...editForm, brand: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">产品名称</label>
                  <input value={editForm.name || ''} onChange={e => setEditForm(editForm => ({...editForm, name: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">分类</label>
                  <select value={editForm.category || ''} onChange={e => setEditForm(editForm => ({...editForm, category: e.target.value, subcategory: ''}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">子分类</label>
                  <select value={editForm.subcategory || ''} onChange={e => setEditForm(editForm => ({...editForm, subcategory: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value=""></option>
                    {(productCategories.find(c => c.name === editForm.category)?.sub ?? []).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">规格</label>
                  <input value={editForm.spec || ''} onChange={e => setEditForm(editForm => ({...editForm, spec: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div className="col-span-2 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">价格维护</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditForm(editForm => ({...editForm, originalPrice: editForm.price ?? editForm.originalPrice ?? 0}))}
                      className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                    >
                      用市场价填目录价
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">目录价</label>
                      <input type="number" min="0" step="0.01" value={editForm.originalPrice ?? ''} onChange={e => setEditForm(editForm => ({...editForm, originalPrice: e.target.value ? parseFloat(e.target.value) : undefined}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">市场价</label>
                      <input type="number" min="0" step="0.01" value={editForm.price ?? 0} onChange={e => setEditForm(editForm => ({...editForm, price: parseFloat(e.target.value) || 0}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">促销价</label>
                      <input type="number" min="0" step="0.01" value={editForm.promotionalPrice ?? ''} onChange={e => setEditForm(editForm => ({...editForm, promotionalPrice: e.target.value ? parseFloat(e.target.value) : undefined}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />

                      <label className="block text-xs text-purple-700 font-semibold mb-1 mt-2">
                        进货价
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.costPrice ?? ''}
                        onChange={e => setEditForm(editForm => ({...editForm, costPrice: e.target.value ? parseFloat(e.target.value) : undefined}))}
                        className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-purple-50/30 focus:ring-2 focus:ring-purple-500"
                        placeholder="经销商结算价"
                      />
                      <label className="block text-xs text-red-700 font-semibold mb-1 mt-2">最低成交价</label>
                      <input
                        type="number" min="0" step="0.01" value={editForm.minimumSalePrice ?? ''}
                        onChange={e => setEditForm(editForm => ({ ...editForm, minimumSalePrice: e.target.value ? parseFloat(e.target.value) : undefined }))}
                        className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm bg-red-50/30 focus:ring-2 focus:ring-red-500"
                        placeholder="价格服务最低限制"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={editForm.promotion || false}
                        onChange={e => setEditForm(editForm => ({...editForm, promotion: e.target.checked}))}
                        className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      启用促销
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-red-700">
                      <input
                        type="checkbox"
                        checked={editForm.hazardous || false}
                        onChange={e => setEditForm(editForm => ({...editForm, hazardous: e.target.checked}))}
                        className="rounded border-gray-300 text-red-500 focus:ring-red-500"
                      />
                      危险化学品（前端下架）
                    </label>
                  </div>
                  {editForm.prices?.find((item) => item.kind === 'cost' && item.source?.includes('供货协议'))?.source && (
                    <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50/60 px-3 py-2.5">
                      <p className="text-xs font-semibold text-purple-800">供货条款（内部）</p>
                      <p className="mt-1 text-xs leading-5 text-purple-700">
                        {editForm.prices.find((item) => item.kind === 'cost' && item.source?.includes('供货协议'))?.source}
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">库存</label>
                  <select value={editForm.inStock ? 'true' : 'false'} onChange={e => setEditForm(editForm => ({...editForm, inStock: e.target.value === 'true'}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value="true">有货</option>
                    <option value="false">缺货</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">宿主</label>
                  <input value={editForm.host || ''} onChange={e => setEditForm(editForm => ({...editForm, host: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">应用 (逗号分隔)</label>
                  <input value={(editForm.applications || []).join(', ')} onChange={e => setEditForm(editForm => ({...editForm, applications: e.target.value.split(',').map(s => s.trim()).filter(Boolean)}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">反应性 (逗号分隔)</label>
                  <input value={(editForm.reactivity || []).join(', ')} onChange={e => setEditForm(editForm => ({...editForm, reactivity: e.target.value.split(',').map(s => s.trim()).filter(Boolean)}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>

                <div className="col-span-2 border-t border-gray-200 pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">包装规格价格</span>
                    <button type="button" onClick={() => setEditForm((current) => ({ ...current, variants: [...(current.variants || []), { catalogNumber: '', spec: '', price: 0, originalPrice: null, promotionalPrice: null, costPrice: null, minimumSalePrice: null, packageType: null, salesUnit: null, baseQuantity: 1 }] }))} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:border-brand-300 hover:text-brand-700"><Plus className="h-3.5 w-3.5" />新增包装</button>
                  </div>
                  <p className="mb-3 text-xs text-gray-500">耗材等产品的不同包装在此维护，每个包装可设置独立的公开价与内部价。前台下单时按用户选定的包装成交。</p>
                  {(editForm.variants || []).length === 0 ? <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">当前商品使用基础规格与价格</p> : (
                    <div className="space-y-3">
                      {(editForm.variants || []).map((variant, index) => {
                        const patchVariant = (patch: Partial<ProductVariant>) => setEditForm((current) => ({
                          ...current,
                          variants: (current.variants || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
                        }));
                        const numberOrNull = (raw: string) => (raw ? parseFloat(raw) : null);
                        return (
                          <div key={variant.id || index} className="rounded-xl border border-gray-200 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-xs font-semibold text-gray-500">包装 {index + 1}</span>
                              <button type="button" title="删除包装" onClick={() => setEditForm((current) => ({ ...current, variants: (current.variants || []).filter((_, itemIndex) => itemIndex !== index) }))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <label className="col-span-2 block text-xs text-gray-500 sm:col-span-1">规格货号
                                <input value={variant.catalogNumber} onChange={(event) => patchVariant({ catalogNumber: event.target.value })} placeholder="规格货号" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="col-span-2 block text-xs text-gray-500 sm:col-span-1">规格/包装名称
                                <input value={variant.spec} onChange={(event) => patchVariant({ spec: event.target.value })} placeholder="如 1000 支/箱" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="block text-xs text-gray-500">包装类型
                                <select value={variant.packageType ?? ''} onChange={(event) => patchVariant({ packageType: event.target.value || null })} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white">
                                  <option value="">默认</option>
                                  <option value="box">盒 box</option>
                                  <option value="case">箱 case</option>
                                  <option value="tier">阶梯 tier</option>
                                </select>
                              </label>
                              <label className="block text-xs text-gray-500">销售单位
                                <input value={variant.salesUnit ?? ''} onChange={(event) => patchVariant({ salesUnit: event.target.value || null })} placeholder="如 箱、盒" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="block text-xs text-gray-500">最小单位数量
                                <input type="number" min="1" step="1" value={variant.baseQuantity ?? 1} onChange={(event) => patchVariant({ baseQuantity: Math.max(1, parseInt(event.target.value, 10) || 1) })} aria-label="最小单位数量" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="block text-xs text-gray-500">目录价
                                <input type="number" min="0" step="0.01" value={variant.originalPrice ?? ''} onChange={(event) => patchVariant({ originalPrice: numberOrNull(event.target.value) })} aria-label="包装目录价" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="block text-xs text-gray-500">市场价
                                <input type="number" min="0" step="0.01" value={variant.price} onChange={(event) => patchVariant({ price: Number(event.target.value) })} aria-label="包装市场价" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="block text-xs text-gray-500">促销价
                                <input type="number" min="0" step="0.01" value={variant.promotionalPrice ?? ''} onChange={(event) => patchVariant({ promotionalPrice: numberOrNull(event.target.value) })} aria-label="包装促销价" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="block text-xs text-purple-700">进货价（内部）
                                <input type="number" min="0" step="0.01" value={variant.costPrice ?? ''} onChange={(event) => patchVariant({ costPrice: numberOrNull(event.target.value) })} aria-label="包装进货价" className="mt-1 w-full rounded-lg border border-purple-200 bg-purple-50/30 px-2 py-1.5 text-sm" />
                              </label>
                              <label className="block text-xs text-red-700">最低成交价（内部）
                                <input type="number" min="0" step="0.01" value={variant.minimumSalePrice ?? ''} onChange={(event) => patchVariant({ minimumSalePrice: numberOrNull(event.target.value) })} aria-label="包装最低成交价" className="mt-1 w-full rounded-lg border border-red-200 bg-red-50/30 px-2 py-1.5 text-sm" />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* === P2-1: 生物医药专业字段 === */}
                <div className="col-span-2 mt-2 mb-1">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">生物医药专业字段</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">货期 (如 &ldquo;1-2 周&rdquo;)</label>
                  <input value={editForm.leadTime || ''} onChange={e => setEditForm(editForm => ({...editForm, leadTime: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">储存温度 (如 &ldquo;-20°C&rdquo;)</label>
                  <input value={editForm.storageTemp || ''} onChange={e => setEditForm(editForm => ({...editForm, storageTemp: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">储存缓冲液/条件</label>
                  <input value={editForm.storageBuffer || ''} onChange={e => setEditForm(editForm => ({...editForm, storageBuffer: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">有效期</label>
                  <input value={editForm.expiryDate || ''} onChange={e => setEditForm(editForm => ({...editForm, expiryDate: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="2027-12-31" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">批号 / Lot</label>
                  <input value={editForm.lotNumber || ''} onChange={e => setEditForm(editForm => ({...editForm, lotNumber: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">克隆号 / 目录株号</label>
                  <input value={editForm.cloneNumber || ''} onChange={e => setEditForm(editForm => ({...editForm, cloneNumber: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">纯度 (如 {">"}95%)</label>
                  <input value={editForm.purity || ''} onChange={e => setEditForm(editForm => ({...editForm, purity: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">分子量 (kDa)</label>
                  <input type="number" step="0.01" value={editForm.molecularWeight ?? ''} onChange={e => setEditForm(editForm => ({...editForm, molecularWeight: e.target.value ? parseFloat(e.target.value) : undefined}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">等电点 (pI)</label>
                  <input type="number" step="0.01" value={editForm.isoelectricPoint ?? ''} onChange={e => setEditForm(editForm => ({...editForm, isoelectricPoint: e.target.value ? parseFloat(e.target.value) : undefined}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">浓度 (如 &ldquo;1 mg/mL&rdquo;)</label>
                  <input value={editForm.concentration || ''} onChange={e => setEditForm(editForm => ({...editForm, concentration: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">库存数量 (-1=无限)</label>
                  <input type="number" value={editForm.stockQuantity ?? -1} onChange={e => setEditForm(editForm => ({...editForm, stockQuantity: parseInt(e.target.value) || -1}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CoA 证书 URL</label>
                  <input value={editForm.cofaUrl || ''} onChange={e => setEditForm(editForm => ({...editForm, cofaUrl: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="https://..." />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">SDS 安全表 URL</label>
                  <input value={editForm.sdsUrl || ''} onChange={e => setEditForm(editForm => ({...editForm, sdsUrl: e.target.value}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="https://..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">引用文献 PMID (逗号分隔)</label>
                  <input value={(editForm.pmids || []).join(', ')} onChange={e => setEditForm(editForm => ({...editForm, pmids: e.target.value.split(',').map(s => s.trim()).filter(Boolean)}))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="12345678, 87654321" />
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => editForm.id && handleDelete(editForm.id)} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">删除产品</button>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedProduct(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">取消</button>
                  <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60">
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
