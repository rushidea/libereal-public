'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { parsePromotionDefinition, promotionSkuKey, type PromotionDefinition, type PromotionGroup, type PromotionSkuBinding } from '@/data/promotion-foundation';
import type { ManagedPromotion } from '@/lib/promotion-repository';

type Choice = PromotionSkuBinding & { label: string; allVariants?: true };
const choiceKey = (choice: Choice) => choice.allVariants ? JSON.stringify([choice.productId, 'all-variants']) : promotionSkuKey(choice);
type SearchProduct = { id: string; name: string; catalogNumber: string; variantsTruncated?: boolean; variants: Array<{ id: string; catalogNumber: string; spec: string }> };
const templates: Record<PromotionDefinition['template'], string> = {
  addon: '满数量加价购', gift: '满数量赠品', 'same-sku-gift': '同款买赠',
  bundle: '多组商品组合', 'direct-price': '单品活动价', 'buy-n-get-m': '买 N 件免 M 件',
};
const statuses: Record<string, string> = { draft: '草稿', active: '生效中', paused: '已暂停', ended: '已结束' };
const initial: PromotionDefinition = { schemaVersion: 1, template: 'addon', repeat: true, maxApplications: null, partialBenefit: true,
  groups: [{ key: 'main', role: 'qualifier', unit: '盒', quantity: 6 }, { key: 'addon', role: 'benefit', unit: '件', quantity: 1 }],
  benefit: { kind: 'fixed-price', unitPriceCents: 5000 } };
const localDate = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<ManagedPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [idempotencyEnabled, setIdempotencyEnabled] = useState(false);
  const [unifiedPricingEnabled, setUnifiedPricingEnabled] = useState(false);
  const [capabilityKnown, setCapabilityKnown] = useState(false);
  const [capabilityActor, setCapabilityActor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const createRequestRef = useRef<{ digest: string; key: string; actorId: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [legacy, setLegacy] = useState<{ type: string; value: string } | null>(null);
  const [originalDates, setOriginalDates] = useState<{ startsAt: string; endsAt: string } | null>(null);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [priority, setPriority] = useState(0);
  const [definition, setDefinition] = useState<PromotionDefinition>(initial);
  const [bindings, setBindings] = useState<Choice[]>([]);
  const [groupKey, setGroupKey] = useState('main');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [productOffset, setProductOffset] = useState(0);
  const [productsHaveMore, setProductsHaveMore] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsPageFailed, setProductsPageFailed] = useState(false);
  const [productsRetry, setProductsRetry] = useState(0);
  const productsLoadingRef = useRef(false);
  const [trial, setTrial] = useState<ManagedPromotion | null>(null);
  const [trialQuantities, setTrialQuantities] = useState<Record<string, number>>({});
  const [trialResult, setTrialResult] = useState('');
  const inputClass = `w-full min-h-11 rounded-lg border px-3 py-2 text-sm ${uiSurfaces.border} ${uiSurfaces.panel} ${uiSurfaces.titleText}`;
  const load = async () => {
    try {
      const response = await fetch('/api/admin/promotions');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '活动加载失败');
      setPromotions(data.promotions);
      setIdempotencyEnabled(data.idempotencyEnabled === true);
      setUnifiedPricingEnabled(data.unifiedPricingEnabled === true);
      setCapabilityActor(typeof data.actorId === 'string' && data.actorId ? data.actorId : null);
      setCapabilityKnown(typeof data.actorId === 'string' && Boolean(data.actorId));
    } catch (failure) { setCapabilityKnown(false); setCapabilityActor(null); setError(failure instanceof Error ? failure.message : '活动加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (search.trim().length < 2) { productsLoadingRef.current = false; setProductsLoading(false); return; }
    productsLoadingRef.current = true;
    setProductsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/promotions/products?search=${encodeURIComponent(search.trim())}&offset=${productOffset}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '商品查询失败');
        setProducts((previous) => productOffset === 0 ? data.products : [...previous, ...data.products]);
        setProductsHaveMore(data.hasMore === true);
        setProductsPageFailed(false);
      } catch (failure) { if (!controller.signal.aborted) { setProductsPageFailed(true); setError(failure instanceof Error ? failure.message : '商品查询失败'); } }
      finally { if (!controller.signal.aborted) { productsLoadingRef.current = false; setProductsLoading(false); } }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, productOffset, productsRetry]);
  const reset = () => { setEditing(null); setEditVersion(null); setLegacy(null); setOriginalDates(null); setName(''); setStartsAt(''); setEndsAt(''); setPriority(0); setBindings([]); setDefinition(initial); setGroupKey('main'); setSearch(''); setProducts([]); setProductOffset(0); setProductsHaveMore(false); setProductsPageFailed(false); };
  const selectTemplate = (template: PromotionDefinition['template']) => {
    const shared = template === 'same-sku-gift' || template === 'buy-n-get-m';
    const direct = template === 'direct-price';
    setDefinition({ ...initial, template, groups: shared ? [{ key: 'main', role: 'qualifier-and-benefit', quantity: 2, unit: '件' }]
      : direct ? [{ key: 'main', role: 'benefit', quantity: 1, unit: '件' }] : initial.groups,
      benefit: shared || template === 'gift' ? { kind: 'gift' } : initial.benefit,
      ...(shared ? { freeQuantity: 1 } : {}),
    });
    setBindings([]); setGroupKey('main');
  };
  const save = async () => {
    if (savingRef.current) return;
    setError(''); setMessage('');
    if (!editing && !capabilityKnown) { setError('活动服务状态未知，请刷新后重试'); return; }
    if (!name.trim() || !startsAt || !endsAt) { setError('请填写活动名称和有效期'); return; }
    let parsed: PromotionDefinition | null = null;
    if (legacy) {
      const value = Number(legacy.value);
      if (!legacy.value.trim() || !Number.isFinite(value) || value < 0 || (legacy.type === 'discount_rate' && (value <= 0 || value > 1))) {
        setError('请检查原活动优惠值'); return;
      }
    } else {
      try { parsed = parsePromotionDefinition(definition); } catch { setError('请检查数量、金额和规则配置'); return; }
    }
    if (parsed?.priceBasis !== 'catalog' && bindings.some((binding) => binding.allVariants)) {
      setError('请先移除发布时全部规格的选择'); return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const body = JSON.stringify({ name,
        startsAt: originalDates && startsAt === localDate(originalDates.startsAt) ? originalDates.startsAt : new Date(startsAt).toISOString(),
        endsAt: originalDates && endsAt === localDate(originalDates.endsAt) ? originalDates.endsAt : new Date(endsAt).toISOString(),
        ...(editing ? {} : { status: 'draft' }), priority, ...(editing && editVersion !== null ? { expectedVersion: editVersion } : {}),
        ...(legacy ? { type: legacy.type, value: Number(legacy.value), ruleDefinition: null } : { ruleDefinition: parsed }),
        ...(parsed?.priceBasis === 'catalog' ? { catalogSelections: bindings.map(({ productId, variantId, groupKey: key, allVariants }) =>
          allVariants ? { productId, allVariants: true, groupKey: key } : { productId, variantId, groupKey: key }) } : {}),
        products: bindings.filter((entry) => !entry.allVariants).map(({ productId, variantId, groupKey: key }) => ({ productId, variantId, groupKey: key })) });
      if (!editing) {
        const stored = sessionStorage.getItem('promotion-create-pending-v1');
        if (stored && !createRequestRef.current) {
          const pending: unknown = JSON.parse(stored);
          if (!pending || typeof pending !== 'object' || !('digest' in pending) || !('key' in pending) || !('actorId' in pending)
            || typeof pending.digest !== 'string' || !/^[0-9a-f]{64}$/.test(pending.digest)
            || typeof pending.key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(pending.key)
            || typeof pending.actorId !== 'string' || !pending.actorId) throw new Error('活动请求记录无效，请联系管理员核对');
          createRequestRef.current = { digest: pending.digest, key: pending.key, actorId: pending.actorId };
        }
        if (createRequestRef.current && createRequestRef.current.actorId !== capabilityActor) throw new Error('前次创建属于其他账号，请先用原账号核对结果');
        if (idempotencyEnabled || createRequestRef.current) {
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
          const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
          if (createRequestRef.current && createRequestRef.current.digest !== digest) {
            throw new Error('前次创建结果未确认，请先核对该活动后再创建其他活动');
          }
          if (!createRequestRef.current && idempotencyEnabled) {
            if (!capabilityActor) throw new Error('活动服务身份未知，请刷新后重试');
            createRequestRef.current = { digest, key: crypto.randomUUID(), actorId: capabilityActor };
            sessionStorage.setItem('promotion-create-pending-v1', JSON.stringify(createRequestRef.current));
          }
        }
      }
      const response = await fetch(editing ? `/api/admin/promotions/${editing}` : '/api/admin/promotions', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json',
          ...(!editing && createRequestRef.current ? { 'Idempotency-Key': createRequestRef.current.key,
            'X-Promotion-Expected-Actor': createRequestRef.current.actorId } : {}) }, body,
      });
      const data = await response.json();
      if (!response.ok) {
        // These responses are emitted before a successful repository commit.
        // Keep the receipt for all uncertain errors, including 409 and 5xx.
        if (!editing && createRequestRef.current && response.status === 400) {
          sessionStorage.removeItem('promotion-create-pending-v1'); createRequestRef.current = null;
        }
        throw new Error(data.error || '保存失败');
      }
      if (!editing && createRequestRef.current) { sessionStorage.removeItem('promotion-create-pending-v1'); createRequestRef.current = null; }
      reset(); setMessage('草稿保存成功'); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const setStatus = async (id: string, status: string, expectedVersion: number) => {
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/admin/promotions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, expectedVersion }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '状态修改失败');
      setMessage('活动状态更新成功'); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '状态修改失败'); }
    finally { setSaving(false); }
  };
  const edit = (promotion: ManagedPromotion) => {
    setEditing(promotion.id); setName(promotion.name); setStartsAt(localDate(promotion.startsAt)); setEndsAt(localDate(promotion.endsAt));
    setEditVersion(promotion.ruleVersion);
    setOriginalDates({ startsAt: promotion.startsAt, endsAt: promotion.endsAt });
    setLegacy(promotion.ruleDefinition ? null : { type: promotion.type, value: String(promotion.value) });
    setPriority(promotion.priority);
    const config = promotion.ruleDefinition ?? { ...initial, template: 'direct-price' as const,
      groups: [{ key: 'main', role: 'benefit' as const, quantity: 1, unit: '件' }],
      benefit: promotion.type === 'discount_rate' ? { kind: 'percentage' as const, basisPoints: Math.round(promotion.value * 10000) }
        : promotion.type === 'amount_off' ? { kind: 'amount-off' as const, amountCents: Math.round(promotion.value * 100) }
          : { kind: 'fixed-price' as const, unitPriceCents: Math.round(promotion.value * 100) } };
    setDefinition(config); setGroupKey(config.groups[0].key);
    const selectors = promotion.catalogSelections;
    if (selectors) setBindings(selectors.map((entry) => {
      const product = promotion.products.find((item) => item.productId === entry.productId);
      const allVariants = 'allVariants' in entry;
      const variant = !allVariants ? promotion.products.find((item) => item.productId === entry.productId && item.variantId === entry.variantId) : undefined;
      return { productId: entry.productId, variantId: allVariants ? null : entry.variantId, groupKey: entry.groupKey,
        ...(allVariants ? { allVariants: true as const } : {}),
        label: allVariants ? `${product?.product.catalogNumber ?? entry.productId} · ${product?.product.name ?? ''} · 发布时全部规格`
          : `${variant?.variant?.catalogNumber ?? product?.product.catalogNumber ?? entry.productId} · ${product?.product.name ?? ''}${variant?.variant ? ` · ${variant.variant.spec}` : ''}` };
    }));
    else setBindings(promotion.products.map((entry) => ({ productId: entry.productId, variantId: entry.variantId,
      groupKey: entry.groupKey, label: `${entry.variant?.catalogNumber ?? entry.product.catalogNumber} · ${entry.product.name}${entry.variant ? ` · ${entry.variant.spec}` : ''}` })));
    setError(''); setMessage('');
  };
  const add = (product: SearchProduct, variant: SearchProduct['variants'][number] | null) => {
    const choice: Choice = { productId: product.id, variantId: variant?.id ?? null, groupKey,
      label: `${variant?.catalogNumber ?? product.catalogNumber} · ${product.name}${variant ? ` · ${variant.spec}` : ''}` };
    if (bindings.some((entry) => choiceKey(entry) === choiceKey(choice) || (entry.productId === product.id && entry.allVariants))) { setError('该规格已经选择'); return; }
    setBindings([...bindings, choice]); setError('');
  };
  const addAllVariants = (product: SearchProduct) => {
    if (!legacy && definition.priceBasis === 'catalog') {
      if (bindings.some((entry) => entry.productId === product.id)) { setError('请先移除该商品已选择的规格'); return; }
      setBindings([...bindings, { productId: product.id, variantId: null, groupKey, allVariants: true,
        label: `${product.catalogNumber} · ${product.name} · 发布时全部规格` }]); setError(''); return;
    }
    if (product.variantsTruncated) { setError('该商品规格过多，请按规格货号搜索并逐项选择'); return; }
    const choices: Choice[] = product.variants.map((variant) => ({ productId: product.id, variantId: variant.id, groupKey,
      label: `${variant.catalogNumber} · ${product.name} · ${variant.spec}` }));
    const existing = new Set(bindings.map(promotionSkuKey));
    const fresh = choices.filter((choice) => !existing.has(promotionSkuKey(choice)));
    if (bindings.length + fresh.length > 2000) { setError('活动最多选择 2000 个商品规格'); return; }
    setBindings([...bindings, ...fresh]); setError('');
  };
  const loadProductVariants = async (productId: string) => {
    setError('');
    try {
      const response = await fetch(`/api/admin/promotions/products?productId=${encodeURIComponent(productId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '商品规格查询失败');
      setProducts((current) => current.map((product) => product.id === productId
        ? { ...product, variants: data.variants, variantsTruncated: data.variantsTruncated } : product));
    } catch (failure) { setError(failure instanceof Error ? failure.message : '商品规格查询失败'); }
  };
  const updateGroup = (index: number, update: Partial<PromotionGroup>) => setDefinition({ ...definition,
    groups: definition.groups.map((group, current) => current === index ? { ...group, ...update } : group) });
  const openTrial = async (promotion: ManagedPromotion) => {
    setError(''); setTrialResult(''); setTrialQuantities({});
    if (promotion.ruleDefinition?.priceBasis !== 'catalog') { setTrial(promotion); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/promotions/${promotion.id}/preview`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolveBindings: true }) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.previewBindings)) throw new Error(data.error || '活动商品查询失败');
      setTrial({ ...promotion, products: data.previewBindings });
    } catch (failure) { setError(failure instanceof Error ? failure.message : '活动商品查询失败'); }
    finally { setSaving(false); }
  };
  const preview = async () => {
    if (!trial) return;
    setSaving(true); setError(''); setTrialResult('');
    try {
      const response = await fetch(`/api/admin/promotions/${trial.id}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trial.products.map((entry) => ({ productId: entry.productId, variantId: entry.variantId,
          quantity: trialQuantities[promotionSkuKey(entry)] ?? 0 }))) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '试算失败');
      if (typeof data.targetApplied === 'boolean' && Number.isSafeInteger(data.totalCents)) {
        setTrialResult(`最终商品金额 ¥${(data.totalCents / 100).toFixed(2)}；${data.targetApplied ? '本活动参与计算' : '本活动未被选中'}`);
      } else {
        setTrialResult(`活动优惠 ¥${(data.discountCents / 100).toFixed(2)}；${data.statuses.map((entry: { message: string }) => entry.message).join('；')}`);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '试算失败'); }
    finally { setSaving(false); }
  };
  const benefit = definition.benefit;
  const benefitValue = benefit.kind === 'gift' ? '' : benefit.kind === 'percentage' ? benefit.basisPoints / 100
    : (benefit.kind === 'fixed-price' ? benefit.unitPriceCents : benefit.kind === 'group-price' ? benefit.groupPriceCents : benefit.amountCents) / 100;
  return <div className={`space-y-6 ${uiSurfaces.titleText}`}>
    <h1 className="text-2xl font-bold">促销活动</h1>
    {error && <p role="alert" className="text-sm text-[var(--brand-color-error-text)]">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <section className={`space-y-4 border-y py-5 ${uiSurfaces.border}`}>
      <fieldset disabled={saving} className="space-y-4">
      <h2 className="text-xl font-semibold">{editing ? '编辑活动' : '新建活动'}</h2>
      <p className="text-sm">时间使用当前浏览器时区；结束时刻不包含在活动内。</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm">活动名称<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {legacy ? <label className="space-y-1 text-sm">原活动类型：{legacy.type}；优惠值（比例以 0–1 表示）<input className={inputClass} type="number" step="any" value={legacy.value} onChange={(event) => setLegacy({ ...legacy, value: event.target.value })} /></label> : <>
          <label className="space-y-1 text-sm">规则模板<select className={inputClass} value={definition.template} onChange={(event) => selectTemplate(event.target.value as PromotionDefinition['template'])}>{Object.entries(templates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="space-y-1 text-sm">最多参与次数<input className={inputClass} type="number" min="1" placeholder="不限" value={definition.maxApplications ?? ''} onChange={(event) => setDefinition({ ...definition, maxApplications: event.target.value ? Number(event.target.value) : null })} /></label>
        </>}
        <label className="space-y-1 text-sm">开始时间<input className={inputClass} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label className="space-y-1 text-sm">结束时间<input className={inputClass} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
        <label className="space-y-1 text-sm">规则优先级<input className={inputClass} type="number" min="-1000" max="1000" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label>
        {!legacy && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={definition.repeat} onChange={(event) => setDefinition({ ...definition, repeat: event.target.checked })} />每达到一次条件重复享受</label>}
      </div>
      {!legacy && <div className="space-y-3">
        {definition.groups.map((group, index) => <div key={group.key} className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-sm">商品组 {index + 1}<select className={inputClass} value={group.role} disabled={definition.template !== 'bundle'} onChange={(event) => updateGroup(index, { role: event.target.value as PromotionGroup['role'] })}>
            <option value="qualifier">主品</option><option value="benefit">附属品或活动商品</option><option value="qualifier-and-benefit">同组购买与优惠商品</option>
          </select></label>
          <label className="space-y-1 text-sm">每组数量<input className={inputClass} type="number" min="1" value={group.quantity} onChange={(event) => updateGroup(index, { quantity: Number(event.target.value) })} /></label>
          <label className="space-y-1 text-sm">计量单位<input className={inputClass} value={group.unit} onChange={(event) => updateGroup(index, { unit: event.target.value })} /></label>
        </div>)}
        {definition.template === 'bundle' && <button className={uiSurfaces.buttonSecondary} onClick={() => setDefinition({ ...definition, groups: [...definition.groups, { key: `group-${definition.groups.length + 1}`, role: 'qualifier', quantity: 1, unit: '件' }] })}><Plus className="h-4 w-4" />添加商品组</button>}
      </div>}
      {!legacy && <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">优惠方式<select className={inputClass} value={benefit.kind} disabled={['gift', 'same-sku-gift', 'buy-n-get-m'].includes(definition.template)} onChange={(event) => {
          const kind = event.target.value;
          if (bindings.some((binding) => binding.allVariants)) { setError('请先移除发布时全部规格的选择'); return; }
          const withoutPriceBasis = { ...definition }; delete withoutPriceBasis.priceBasis;
          setDefinition({ ...withoutPriceBasis, partialBenefit: kind !== 'group-price', benefit: kind === 'gift' ? { kind }
            : kind === 'fixed-price' ? { kind, unitPriceCents: 0 } : kind === 'amount-off' ? { kind, amountCents: 0 }
              : kind === 'percentage' ? { kind, basisPoints: 9000 } : { kind: 'group-price', groupPriceCents: 0 } });
        }}><option value="fixed-price">每件活动价</option><option value="group-price">整组活动价</option><option value="gift">免费赠送</option><option value="amount-off">每件减金额</option><option value="percentage">按原价百分比</option></select></label>
        {benefit.kind === 'percentage' && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={definition.priceBasis === 'catalog'} onChange={(event) => {
          if (event.target.checked) setDefinition({ ...definition, priceBasis: 'catalog' });
          else if (bindings.some((binding) => binding.allVariants)) setError('请先移除发布时全部规格的选择');
          else { const rest = { ...definition }; delete rest.priceBasis; setDefinition(rest); }
        }} />使用各商品或规格的目录价（暂不可发布）</label>}
        {benefit.kind !== 'gift' && <label className="space-y-1 text-sm">{benefit.kind === 'percentage' ? '成交比例 %' : '金额 元'}<input className={inputClass} type="number" min="0" step="0.01" value={benefitValue} onChange={(event) => {
          const value = Math.round(Number(event.target.value) * 100);
          setDefinition({ ...definition, benefit: benefit.kind === 'fixed-price' ? { kind: benefit.kind, unitPriceCents: value }
            : benefit.kind === 'amount-off' ? { kind: benefit.kind, amountCents: value } : benefit.kind === 'percentage'
              ? { kind: benefit.kind, basisPoints: value } : { kind: 'group-price', groupPriceCents: value } });
        }} /></label>}
        {definition.freeQuantity !== undefined && <label className="space-y-1 text-sm">每组免费件数<input className={inputClass} type="number" min="1" value={definition.freeQuantity} onChange={(event) => setDefinition({ ...definition, freeQuantity: Number(event.target.value) })} /></label>}
        {benefit.kind !== 'group-price' && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={definition.partialBenefit} onChange={(event) => setDefinition({ ...definition, partialBenefit: event.target.checked })} />允许购买部分附属品</label>}
      </div>}
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        {!legacy && <label className="space-y-1 text-sm">绑定到商品组<select className={inputClass} value={groupKey} onChange={(event) => setGroupKey(event.target.value)}>{definition.groups.map((group, index) => <option key={group.key} value={group.key}>商品组 {index + 1} · {group.role === 'qualifier' ? '主品' : '优惠商品'}</option>)}</select></label>}
        <label className="space-y-1 text-sm">搜索货号或商品名称<input className={inputClass} value={search} onChange={(event) => { setSearch(event.target.value); setProducts([]); setProductOffset(0); setProductsHaveMore(false); setProductsPageFailed(false); }} /></label>
      </div>
      {search.trim().length >= 2 && <div className="max-h-60 space-y-1 overflow-y-auto">{products.map((product) => <div key={product.id} className={`border-b py-2 text-sm ${uiSurfaces.border}`}>
        <button className="min-h-11 text-left" onClick={() => add(product, null)}>{product.catalogNumber} · {product.name} · {legacy ? '商品级绑定（沿用原活动语义）' : '商品本身（不代表全部规格）'}</button>
        {product.variantsTruncated && <><p className="pl-4">规格未全部列出；超过 2000 个规格时请按货号逐项选择。</p><button className="min-h-11 pl-4 text-left" onClick={() => { void loadProductVariants(product.id); }}>重新加载该商品规格</button></>}
        {product.variants.length > 0 && <button className="block min-h-11 pl-4 text-left" onClick={() => addAllVariants(product)}>{!legacy && definition.priceBasis === 'catalog' ? '选择发布时全部规格（发布后新增规格需另行加入）' : '选择当前全部规格（后续新增规格需另行加入）'}</button>}
        {product.variants.map((variant) => <button key={variant.id} className="block min-h-11 pl-4 text-left" onClick={() => add(product, variant)}>{variant.catalogNumber} · {variant.spec}</button>)}
      </div>)}</div>}
      {(productsHaveMore || productsPageFailed) && <button disabled={productsLoading} className={uiSurfaces.buttonSecondary} onClick={() => {
        if (productsLoadingRef.current) return;
        productsLoadingRef.current = true; setProductsLoading(true);
        if (productsPageFailed) setProductsRetry((retry) => retry + 1); else setProductOffset((offset) => offset + 25);
      }}>{productsPageFailed ? '重试商品查询' : '加载更多商品'}</button>}
      <div className="space-y-2">{bindings.map((binding) => <div key={choiceKey(binding)} className={`flex items-center justify-between gap-3 border-b py-2 text-sm ${uiSurfaces.border}`}>
        <span className="min-w-0 break-words">{!legacy && `商品组 ${definition.groups.findIndex((group) => group.key === binding.groupKey) + 1} · `}{binding.label}</span>
        <button aria-label={`移除 ${binding.label}`} className="min-h-11 min-w-11" onClick={() => setBindings(bindings.filter((entry) => choiceKey(entry) !== choiceKey(binding)))}><X className="mx-auto h-4 w-4" /></button>
      </div>)}</div>
      <div className="flex gap-3"><button className={uiSurfaces.primaryButton} disabled={saving || !bindings.length || (!editing && !capabilityKnown)} onClick={() => { void save(); }}>{saving ? '保存中' : '保存草稿'}</button>{editing && <button className={uiSurfaces.buttonSecondary} onClick={reset}>取消编辑</button>}</div>
      </fieldset>
    </section>
    {trial && <section className={`space-y-3 border-b pb-5 ${uiSurfaces.border}`}>
      <h2 className="text-xl font-semibold">活动试算 · {trial.name}</h2>
      {unifiedPricingEnabled && <p className="text-sm">按当前时间模拟本活动已生效及非会员价格，实际结算按客户身份和结算时间计算。</p>}
      {trial.products.map((entry) => <label key={promotionSkuKey(entry)} className="grid items-center gap-2 text-sm sm:grid-cols-[1fr_8rem]">
        {entry.variant?.catalogNumber ?? entry.product.catalogNumber} · {entry.product.name}
        <input aria-label={`试算数量 ${entry.variant?.catalogNumber ?? entry.product.catalogNumber}`} className={inputClass} type="number" min="0" value={trialQuantities[promotionSkuKey(entry)] ?? 0} onChange={(event) => setTrialQuantities({ ...trialQuantities, [promotionSkuKey(entry)]: Number(event.target.value) })} />
      </label>)}
      <div className="flex gap-3"><button className={uiSurfaces.primaryButton} disabled={saving} onClick={() => { void preview(); }}>计算优惠</button><button className={uiSurfaces.buttonSecondary} onClick={() => setTrial(null)}>关闭试算</button></div>
      {trialResult && <p role="status" className="text-sm">{trialResult}</p>}
    </section>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">活动记录</h2>
      {loading ? <p role="status">正在加载活动</p> : !promotions.length ? <p>暂无活动</p> : promotions.map((promotion) => <div key={promotion.id} className={`space-y-2 border-b py-4 ${uiSurfaces.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-medium">{promotion.name}</h3><span className="text-sm">{statuses[promotion.status]}</span></div>
        <p className={`text-sm ${uiSurfaces.textSecondary}`}>{new Date(promotion.startsAt).toLocaleString('zh-CN')} 至 {new Date(promotion.endsAt).toLocaleString('zh-CN')} · 优先级 {promotion.priority}</p>
        <details className="text-sm"><summary className="cursor-pointer py-2">参与商品</summary>{promotion.products.map((entry) => <p key={promotionSkuKey(entry)} className="py-1">{entry.variant?.catalogNumber ?? entry.product.catalogNumber} · {entry.product.name}</p>)}</details>
        <div className="flex flex-wrap gap-2">
          {promotion.ruleDefinition && (promotion.ruleDefinition.priceBasis !== 'catalog' || unifiedPricingEnabled) && <button disabled={saving} className={uiSurfaces.buttonSecondary} onClick={() => { void openTrial(promotion); }}>试算活动</button>}
          {promotion.status !== 'active' && promotion.status !== 'ended' && <><button disabled={saving} className={uiSurfaces.buttonSecondary} onClick={() => edit(promotion)}>编辑</button><button disabled={saving} className={uiSurfaces.primaryButton} onClick={() => { void setStatus(promotion.id, 'active', promotion.ruleVersion); }}>发布活动</button></>}
          {promotion.status === 'active' && <button disabled={saving} className={uiSurfaces.buttonSecondary} onClick={() => { void setStatus(promotion.id, 'paused', promotion.ruleVersion); }}>暂停活动</button>}
          {promotion.status !== 'ended' && <button disabled={saving} className={uiSurfaces.buttonSecondary} onClick={() => { void setStatus(promotion.id, 'ended', promotion.ruleVersion); }}>结束活动</button>}
        </div>
      </div>)}
    </section>
  </div>;
}
