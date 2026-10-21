'use client';

import { useEffect, useMemo, useState } from 'react';
import { Ticket } from 'lucide-react';
import { productCategories } from '@/data/categories';
import {
  formatCouponScopeLabel,
  parseCouponScope,
  type CouponProductTarget,
  type CouponScopeType,
} from '@/lib/coupon-scope';
import { uiSurfaces } from '@/lib/ui-surfaces';

type CouponRow = {
  id: string;
  name: string;
  type: string;
  threshold: number;
  discount: number;
  approvalStatus: string;
  description: string | null;
  maxUses: number;
  scopeType: string;
  scopeTargets: string;
  _count?: { instances: number };
};

type SearchProduct = {
  id: string;
  name: string;
  catalogNumber: string;
  variants: Array<{ id: string; catalogNumber: string; spec: string }>;
};

const inputClass = `w-full min-h-11 rounded-lg border px-3 py-2 text-sm ${uiSurfaces.border} ${uiSurfaces.panel} ${uiSurfaces.titleText}`;

const categoryOptions = (() => {
  const seen = new Set<string>();
  const options: Array<{ name: string; depth: number }> = [];
  for (const category of productCategories) {
    if (!seen.has(category.name)) {
      seen.add(category.name);
      options.push({ name: category.name, depth: 0 });
    }
    for (const sub of category.sub) {
      if (seen.has(sub.name)) continue;
      seen.add(sub.name);
      options.push({ name: sub.name, depth: 1 });
    }
  }
  return options;
})();

function scopeSummary(row: CouponRow): string {
  return formatCouponScopeLabel(parseCouponScope(row.scopeType, row.scopeTargets));
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'threshold' | 'unrestricted'>('threshold');
  const [threshold, setThreshold] = useState('100');
  const [discount, setDiscount] = useState('10');
  const [validDays, setValidDays] = useState('');
  const [maxUses, setMaxUses] = useState('0');
  const [description, setDescription] = useState('');
  const [scopeType, setScopeType] = useState<CouponScopeType>('all');
  const [brands, setBrands] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<CouponProductTarget[]>([]);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<SearchProduct[]>([]);

  const load = async () => {
    try {
      const response = await fetch('/api/admin/coupons');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '优惠券加载失败');
      setCoupons(Array.isArray(data) ? data : []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '优惠券加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    void fetch('/api/admin/discount-templates/brands')
      .then((response) => response.json())
      .then((data) => { if (Array.isArray(data.brands)) setBrands(data.brands); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (search.trim().length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/promotions/products?search=${encodeURIComponent(search.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '商品查询失败');
        setProducts(data.products ?? []);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '商品查询失败');
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);

  const previewLabel = useMemo(() => {
    if (scopeType === 'brand') return formatCouponScopeLabel({ type: 'brand', brands: selectedBrands });
    if (scopeType === 'category') return formatCouponScopeLabel({ type: 'category', categories: selectedCategories });
    if (scopeType === 'product') return formatCouponScopeLabel({ type: 'product', products: selectedProducts });
    return '全站商品';
  }, [scopeType, selectedBrands, selectedCategories, selectedProducts]);

  const reset = () => {
    setEditing(null);
    setName('');
    setType('threshold');
    setThreshold('100');
    setDiscount('10');
    setValidDays('');
    setMaxUses('0');
    setDescription('');
    setScopeType('all');
    setSelectedBrands([]);
    setSelectedCategories([]);
    setSelectedProducts([]);
    setSearch('');
    setProducts([]);
  };

  const edit = (row: CouponRow) => {
    const scope = parseCouponScope(row.scopeType, row.scopeTargets);
    setEditing(row.id);
    setName(row.name);
    setType(row.type === 'unrestricted' ? 'unrestricted' : 'threshold');
    setThreshold(String(row.threshold));
    setDiscount(String(row.discount));
    setValidDays('');
    setMaxUses(String(row.maxUses));
    setDescription(row.description ?? '');
    setScopeType(scope.type);
    setSelectedBrands(scope.type === 'brand' ? scope.brands : []);
    setSelectedCategories(scope.type === 'category' ? scope.categories : []);
    setSelectedProducts(scope.type === 'product' ? scope.products : []);
    setError('');
    setMessage('');
  };

  const scopePayload = () => {
    if (scopeType === 'brand') return selectedBrands;
    if (scopeType === 'category') return selectedCategories;
    if (scopeType === 'product') return selectedProducts;
    return [];
  };

  const save = async () => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const payload = {
        name,
        type,
        threshold: Number(threshold),
        discount: Number(discount),
        maxUses: Number(maxUses),
        description,
        scopeType,
        scopeTargets: scopePayload(),
        ...(validDays.trim() ? { validDays: Number(validDays) } : {}),
      };
      const response = await fetch(editing ? `/api/admin/coupons/${editing}` : '/api/admin/coupons', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { action: 'update', ...payload } : payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      setMessage(data.message || '已保存');
      reset();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleName = (current: string[], value: string, setter: (next: string[]) => void) => {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const addProduct = (product: SearchProduct, variant: SearchProduct['variants'][number] | null) => {
    const variantId = variant?.id ?? null;
    setSelectedProducts((current) => {
      if (variantId == null) {
        return [
          ...current.filter((item) => item.productId !== product.id),
          { productId: product.id, variantId: null, label: `${product.catalogNumber} · ${product.name}` },
        ];
      }
      if (!variant || current.some((item) => item.productId === product.id && item.variantId == null)) return current;
      if (current.some((item) => item.productId === product.id && item.variantId === variantId)) return current;
      return [...current, {
        productId: product.id,
        variantId,
        label: `${variant.catalogNumber} · ${product.name} · ${variant.spec}`,
      }];
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className={`flex items-center gap-2 text-2xl font-bold ${uiSurfaces.titleText}`}>
          <Ticket className="h-6 w-6 text-brand-600" /> 优惠券
        </h1>
        <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>创建和编辑券模板。适用范围默认全站，可改为指定品牌、品类或商品规格。</p>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      <section className={`space-y-4 rounded-2xl border p-4 ${uiSurfaces.border} ${uiSurfaces.panel}`}>
        <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>{editing ? '编辑券模板' : '新建券模板'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">券名称
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">券类型
            <select className={inputClass} value={type} disabled={Boolean(editing)} onChange={(event) => setType(event.target.value as 'threshold' | 'unrestricted')}>
              <option value="threshold">满减券（互斥）</option>
              <option value="unrestricted">无门槛券（可叠加，需二次授权）</option>
            </select>
          </label>
          {type === 'threshold' && (
            <label className="space-y-1 text-sm">满减门槛（元）
              <input className={inputClass} inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            </label>
          )}
          <label className="space-y-1 text-sm">优惠金额（元）
            <input className={inputClass} inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">有效天数（空则{editing ? '不修改' : '不限'}）
            <input className={inputClass} inputMode="numeric" value={validDays} onChange={(event) => setValidDays(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">发放上限（0 为不限）
            <input className={inputClass} inputMode="numeric" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
          </label>
        </div>
        <label className="block space-y-1 text-sm">说明
          <input className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>

        <fieldset className="space-y-3">
          <legend className={`text-sm font-medium ${uiSurfaces.titleText}`}>适用范围 · {previewLabel}</legend>
          <div className="flex flex-wrap gap-2">
            {([
              ['all', '全站'],
              ['brand', '指定品牌'],
              ['category', '指定品类'],
              ['product', '指定商品/规格'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScopeType(value)}
                className={`min-h-11 rounded-lg border px-3 text-sm ${scopeType === value ? 'border-brand-500 bg-brand-50 text-brand-800' : `${uiSurfaces.border} ${uiSurfaces.titleText}`}`}
              >
                {label}
              </button>
            ))}
          </div>

          {scopeType === 'brand' && (
            <div className={`max-h-60 space-y-1 overflow-y-auto rounded-xl border p-2 ${uiSurfaces.border}`}>
              {brands.length === 0 && <p className={`text-sm ${uiSurfaces.mutedText}`}>暂无品牌</p>}
              {brands.map((brand) => (
                <label key={brand} className="flex min-h-11 items-center gap-2 px-2 text-sm">
                  <input type="checkbox" checked={selectedBrands.includes(brand)} onChange={() => toggleName(selectedBrands, brand, setSelectedBrands)} />
                  {brand}
                </label>
              ))}
            </div>
          )}

          {scopeType === 'category' && (
            <div className={`max-h-60 space-y-1 overflow-y-auto rounded-xl border p-2 ${uiSurfaces.border}`}>
              {categoryOptions.map((option) => (
                <label key={option.name} className="flex min-h-11 items-center gap-2 px-2 text-sm" style={{ paddingLeft: option.depth ? 20 : 8 }}>
                  <input type="checkbox" checked={selectedCategories.includes(option.name)} onChange={() => toggleName(selectedCategories, option.name, setSelectedCategories)} />
                  {option.name}
                </label>
              ))}
            </div>
          )}

          {scopeType === 'product' && (
            <div className="space-y-2">
              <label className="block space-y-1 text-sm">搜索货号或商品名称
                <input className={inputClass} value={search} onChange={(event) => { setSearch(event.target.value); setProducts([]); }} />
              </label>
              {search.trim().length >= 2 && (
                <div className={`max-h-60 space-y-1 overflow-y-auto rounded-xl border p-2 ${uiSurfaces.border}`}>
                  {products.map((product) => (
                    <div key={product.id} className={`border-b py-2 text-sm ${uiSurfaces.border}`}>
                      <button type="button" className="min-h-11 text-left" onClick={() => addProduct(product, null)}>
                        {product.catalogNumber} · {product.name} · 全部规格
                      </button>
                      {product.variants.map((variant) => (
                        <button key={variant.id} type="button" className="block min-h-11 pl-4 text-left" onClick={() => addProduct(product, variant)}>
                          {variant.catalogNumber} · {variant.spec}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <ul className="space-y-1">
                {selectedProducts.map((item) => (
                  <li key={`${item.productId}:${item.variantId ?? ''}`} className="flex items-center justify-between gap-2 text-sm">
                    <span>{item.label || item.productId}{item.variantId ? '' : '（全部规格）'}</span>
                    <button type="button" className="min-h-11 px-2 text-red-600" onClick={() => setSelectedProducts((current) => current.filter((candidate) => !(candidate.productId === item.productId && candidate.variantId === item.variantId)))}>移除</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </fieldset>

        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => void save()} className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-60">
            {saving ? '保存中…' : editing ? '保存修改' : '创建券模板'}
          </button>
          {editing && <button type="button" onClick={reset} className={`min-h-11 rounded-lg border px-4 text-sm ${uiSurfaces.border}`}>取消编辑</button>}
        </div>
      </section>

      <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panel}`}>
        <h2 className={`border-b px-4 py-3 text-base font-semibold ${uiSurfaces.border} ${uiSurfaces.titleText}`}>券模板</h2>
        {loading ? <p className="px-4 py-6 text-sm">加载中…</p> : coupons.length === 0 ? <p className={`px-4 py-6 text-sm ${uiSurfaces.mutedText}`}>还没有券模板</p> : (
          <ul>
            {coupons.map((coupon) => (
              <li key={coupon.id} className={`flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${uiSurfaces.border}`}>
                <div>
                  <p className={`font-medium ${uiSurfaces.titleText}`}>{coupon.name}</p>
                  <p className={`text-sm ${uiSurfaces.mutedText}`}>
                    {coupon.type === 'unrestricted' ? '无门槛' : `满 ${coupon.threshold} 减 ${coupon.discount}`}
                    {coupon.type === 'unrestricted' ? ` · 减 ${coupon.discount}` : ''}
                    {' · '}{scopeSummary(coupon)}
                    {' · '}{coupon.approvalStatus}
                    {coupon._count ? ` · 已发放 ${coupon._count.instances}` : ''}
                  </p>
                </div>
                <button type="button" className="min-h-11 self-start rounded-lg border px-3 text-sm" onClick={() => edit(coupon)}>编辑</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
