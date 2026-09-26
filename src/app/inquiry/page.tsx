'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useCart, QuickOrderItem } from '@/context/CartContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Send, CheckCircle, Package, Building2, User as UserIcon, Phone, Mail, MapPin, MessageSquare, CreditCard, ChevronRight, Minus, Plus, X } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import Breadcrumb from '@/components/Breadcrumb';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { isPricedProduct } from '@/lib/product-pricing';
import OrganizationContextSelect from '@/components/account/OrganizationContextSelect';

type Step = 'confirm' | 'form' | 'success';

interface ConfirmedItem {
  name: string;
  brand: string;
  catalogNumber: string;
  quantity: number;
  unit: string;
  maxLeadTime: string;
  isQuickOrder?: boolean;
  itemId: string;
}

interface SavedAddress {
  id: string;
  name: string;
  phone: string;
  address: string;
  institution: string | null;
  label: string | null;
  isDefault: boolean;
}

const LEAD_TIME_OPTIONS = [
  { value: '', label: '不限' },
  { value: '7', label: '7天' },
  { value: '14', label: '14天' },
  { value: '30', label: '30天' },
  { value: '60', label: '60天' },
];

export default function InquiryPage() {
  const { items, removeItem, updateQuantity } = useCart();
  const { data: session, status } = useSession();
  const user = session?.user ?? null;
  const router = useRouter();
  const [step, setStep] = useState<Step>('confirm');
  const [submitting, setSubmitting] = useState(false);
  const [rateLimitError, setRateLimitError] = useState('');
  const [confirmedItems, setConfirmedItems] = useState<ConfirmedItem[]>([]);
  const [editStates, setEditStates] = useState<Array<{ quantity: number; maxLeadTime: string }>>([]);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    institution: '',
    department: '',
    address: '',
    paymentMethod: '',
    identity: '',
    advisorName: '',
    advisorPhone: '',
    notes: '',
    honeypot: '',
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/inquiry');
    }
  }, [status, router]);

  const productItems = useMemo(
    () => items.filter(i => !i.isQuickOrder && !isPricedProduct(i.product)),
    [items],
  );
  const quickOrderItems = useMemo(
    () => items.filter(i => i.isQuickOrder),
    [items],
  );
  const unpricedItems = useMemo(() => [...productItems, ...quickOrderItems], [productItems, quickOrderItems]);

  useEffect(() => {
    if (unpricedItems.length === 0 && step === 'confirm' && status === 'authenticated') {
      router.replace('/cart');
    }
  }, [unpricedItems.length, step, status, router]);

  useEffect(() => {
    setEditStates((prev) => unpricedItems.map((item, index) => ({
      quantity: item.quantity,
      maxLeadTime: prev[index]?.maxLeadTime ?? '',
    })));
  }, [unpricedItems]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (data.profile) {
          setForm(prev => ({
            ...prev,
            name: prev.name || data.profile.name || '',
            email: prev.email || data.profile.email || '',
            phone: prev.phone || data.profile.phone || '',
            institution: prev.institution || data.profile.institution || '',
            department: prev.department || data.profile.department || '',
            identity: prev.identity || data.profile.identity || '',
            advisorName: prev.advisorName || data.profile.advisorName || '',
            advisorPhone: prev.advisorPhone || data.profile.advisorPhone || '',
          }));
        }
      })
      .catch(() => {});
  }, [status]);

  const applySavedAddress = (address: SavedAddress) => {
    setSelectedAddressId(address.id);
    setForm(prev => ({
      ...prev,
      name: address.name,
      phone: address.phone,
      institution: address.institution || prev.institution,
      address: address.address,
    }));
  };

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;
    fetch('/api/addresses')
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        if (cancelled || !Array.isArray(data)) return;
        const addresses = data as SavedAddress[];
        setSavedAddresses(addresses);
        const defaultAddress = addresses.find(address => address.isDefault) || addresses[0];
        if (defaultAddress) applySavedAddress(defaultAddress);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'loading') {
    return (
      <div className={`flex min-h-screen items-center justify-center ${uiSurfaces.servicePage}`}>
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return null;
  }

  if (unpricedItems.length === 0 && step === 'confirm') {
    return null;
  }

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  const handleConfirmItems = () => {
    const confirmed: ConfirmedItem[] = unpricedItems.map((item, idx) => {
      const editState = editStates[idx] || { quantity: 1, maxLeadTime: '' };
      if ('product' in item) {
        return {
          name: item.product.name,
          brand: item.product.brand,
          catalogNumber: item.product.catalogNumber,
          quantity: editState.quantity,
          unit: item.product.spec || '单位',
          maxLeadTime: editState.maxLeadTime,
          isQuickOrder: false,
          itemId: item.product.id,
        };
      } else {
        const qItem = item as QuickOrderItem;
        return {
          name: qItem.name,
          brand: qItem.brand,
          catalogNumber: qItem.catalogNumber,
          quantity: editState.quantity,
          unit: qItem.unit,
          maxLeadTime: editState.maxLeadTime,
          isQuickOrder: true,
          itemId: qItem.quickId,
        };
      }
    });
    setConfirmedItems(confirmed);
    setStep('form');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.identity === '学生') {
      const phoneDigits = form.phone.replace(/\D/g, '');
      const advisorDigits = form.advisorPhone.replace(/\D/g, '');
      if (phoneDigits.length >= 7 && advisorDigits.length >= 7) {
        let matchLen = 0;
        const maxCheck = Math.min(phoneDigits.length, advisorDigits.length);
        for (let i = 0; i < maxCheck; i++) {
          if (phoneDigits[i] === advisorDigits[i]) { matchLen++; if (matchLen > 6) break; }
          else { matchLen = 0; }
        }
        if (matchLen > 6) {
          alert('导师电话与订购人电话相同数字超过6位，请填写另一电话号码');
          return;
        }
      }
    }

    setSubmitting(true);

    const lines = [
      '【询价请求】',
      `提交时间: ${new Date().toLocaleString('zh-CN')}`,
      `用户: ${user?.name ?? 'N/A'} <${user?.email ?? 'N/A'}> (${user?.id ?? 'N/A'})`,
      '',
      '=== 采购者信息 ===',
      `姓名: ${form.name}`,
      `邮箱: ${form.email}`,
      `电话: ${form.phone}`,
      `单位: ${form.institution}`,
      `部门: ${form.department}`,
      '身份: ' + (form.identity || '未填写'),
      form.identity === '学生' ? ('导师姓名: ' + form.advisorName + '\n导师电话: ' + (form.advisorPhone || '未填写')) : null,
      '地址: ' + form.address,
      `付款方式: ${form.paymentMethod || '未指定'}`,
      `备注: ${form.notes}`,
      '',
      '=== 询价商品 ===',
      ...confirmedItems.map((item, i) => {
        return `${i + 1}. ${item.name} [${item.brand}]\n   货号: ${item.catalogNumber}\n   数量: ${item.quantity} ${item.unit}\n   最大货期: ${item.maxLeadTime || '不限'}\n   价格: 待报价`;
      }),
      '',
      '合计: ' + formatPrice(0),
    ];

    const body = lines.filter(Boolean).join('\n');

    const inquiryItems = confirmedItems.map(item => ({
      name: item.name,
      brand: item.brand,
      catalogNumber: item.catalogNumber,
      quantity: item.quantity,
      unit: item.unit,
      price: 0,
      customerLeadTime: item.maxLeadTime || null,
      actualLeadTime: null,
      available: null,
    }));

    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          items: inquiryItems,
          subtotal: 0,
          body,
          userId: user?.id ?? null,
          organizationId: organizationId || undefined,
        }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error || '请求过于频繁，请稍后再试。');
        setSubmitting(false);
        return;
      }
      if (!res.ok) throw new Error('Request failed');
    } catch {}

    setSubmitting(false);
    setStep('success');
    unpricedItems.forEach(item => {
      if ('product' in item) {
        removeItem(item.product.id);
      } else {
        removeItem((item as QuickOrderItem).quickId);
      }
    });
    setTimeout(() => {
      router.push('/cart');
    }, 2000);
  };

  const inputClass = (hasError: boolean) =>
    `w-full px-3.5 py-2.5 text-sm ${uiSurfaces.input} ${hasError ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''}`;

  const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5';

  if (step === 'success') {
    return (
      <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
        <AdaptiveHeader />

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-20">
          <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-10 h-10 text-brand-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">询价请求已提交</h2>
          <p className="text-gray-500 text-center max-w-md mb-2">
            感谢您的询价。我们的客服团队将在 <strong>24 小时</strong>内通过邮件或电话与您联系。
          </p>
          <p className="text-gray-400 text-sm text-center mb-8">
            询价确认邮件已发送至 {form.email}
          </p>
          <div className="flex gap-3">
            <Link href="/products" className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-lg font-medium transition-colors">继续浏览</Link>
            <Link href="/" className="border border-gray-300 hover:border-gray-400 text-gray-600 px-6 py-3 rounded-lg font-medium transition-colors">返回首页</Link>
          </div>
        </div>

        <SiteFooter />
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
        <AdaptiveHeader />

        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
          <Breadcrumb items={[
            { label: '首页', href: '/' },
            { label: '购物车', href: '/cart' },
            { label: '询价确认' }
          ]} />

          <h1 className="text-2xl font-bold text-gray-900 mb-2">询价产品确认</h1>

          <div className={`mb-6 rounded-[1.15rem] p-5 ${uiSurfaces.panelStrong}`}>
            <div className="space-y-4">
              {unpricedItems.map((item, idx) => {
                const itemName = 'product' in item ? (item as { product: { name: string } }).product.name : (item as QuickOrderItem).name;
                const itemBrand = 'product' in item ? (item as { product: { brand: string } }).product.brand : (item as QuickOrderItem).brand;
                const itemCatalog = 'product' in item ? (item as { product: { catalogNumber: string } }).product.catalogNumber : (item as QuickOrderItem).catalogNumber;
                const itemSpec = 'product' in item ? ((item as { product: { spec: string | null } }).product.spec || '单位') : (item as QuickOrderItem).unit;
                const itemId = 'product' in item ? item.product.id : item.quickId;
                const currentEdit = editStates[idx] || { quantity: 1, maxLeadTime: '' };
                const setQuantity = (quantity: number) => {
                  const nextQuantity = Math.max(1, quantity);
                  setEditStates((prev) => {
                    const newStates = [...prev];
                    newStates[idx] = { ...(prev[idx] ?? currentEdit), quantity: nextQuantity };
                    return newStates;
                  });
                  updateQuantity(itemId, nextQuantity);
                };

                return (
                  <div key={idx} className={`rounded-xl p-4 ${uiSurfaces.panel}`}>
                    <div className="mb-3 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900">{itemName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{itemBrand} · {itemCatalog}</p>
                        <p className="text-xs text-gray-400 mt-0.5">规格: {itemSpec}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(itemId)}
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                        aria-label="移除询价产品"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">数量</label>
                        <div className={`flex h-10 items-center ${uiSurfaces.input}`}>
                          <button
                            type="button"
                            onClick={() => setQuantity(currentEdit.quantity - 1)}
                            className="flex h-full w-10 items-center justify-center text-gray-500 transition hover:text-brand-600 disabled:text-gray-300"
                            disabled={currentEdit.quantity <= 1}
                            aria-label="减少数量"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={currentEdit.quantity}
                            onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                            className="h-full min-w-0 flex-1 border-0 bg-transparent text-center text-sm font-medium text-gray-800 outline-none focus:ring-0 dark:text-slate-700"
                          />
                          <button
                            type="button"
                            onClick={() => setQuantity(currentEdit.quantity + 1)}
                            className="flex h-full w-10 items-center justify-center text-gray-500 transition hover:text-brand-600"
                            aria-label="增加数量"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">可等待的最长时间</label>
                        <select
                          value={currentEdit.maxLeadTime}
                          onChange={(e) => {
                            const newStates = [...editStates];
                            newStates[idx] = { ...newStates[idx], maxLeadTime: e.target.value };
                            setEditStates(newStates);
                          }}
                          className={`w-full px-3 py-2 text-sm ${uiSurfaces.input}`}
                        >
                          {LEAD_TIME_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleConfirmItems}
            className={`${uiSurfaces.primaryButton} w-full py-4 text-base`}
          >
            下一步：填写询价信息
            <ChevronRight className="w-5 h-5" />
          </button>
        </main>

        <SiteFooter />
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">提交询价</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-6 lg:col-span-2">
            <OrganizationContextSelect value={organizationId} onChange={setOrganizationId} />
            <div className={`overflow-hidden rounded-[1.15rem] ${uiSurfaces.panel}`}>
              <div className="border-b border-white/70 bg-white/42 px-5 py-4 dark:border-slate-300 dark:bg-slate-200/40">
                <h2 className="font-semibold text-gray-800">询价商品 ({confirmedItems.length})</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {confirmedItems.map((item, idx) => (
                  <div key={idx} className="px-5 py-3.5 flex items-center gap-4">
                    <div className="rounded p-2 flex-shrink-0 bg-amber-50">
                      <Package className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.brand} · {item.catalogNumber}{item.unit && ` · ${item.unit}`}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-amber-600">待报价</p>
                      <p className="text-xs text-gray-400">× {item.quantity}</p>
                      {item.maxLeadTime && <p className="text-xs text-gray-400">{item.maxLeadTime}天</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmit} className={`space-y-5 rounded-[1.15rem] p-5 ${uiSurfaces.panelStrong}`}>
              <h2 className="font-semibold text-gray-800 border-b border-gray-100 pb-3">联系信息</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}><span className="flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5" /> 姓名 <span className="text-red-400">*</span></span></label>
                  <input required type="text" placeholder="张三"
                    value={form.name} onChange={(e) => setForm(form => ({...form, name: e.target.value }))}
                    className={inputClass(!form.name)} />
                </div>
                <div>
                  <label className={labelClass}><span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> 邮箱 <span className="text-red-400">*</span></span></label>
                  <input required type="email" placeholder="you@institution.edu.cn"
                    value={form.email} onChange={(e) => setForm(form => ({...form, email: e.target.value }))}
                    className={inputClass(!form.email)} />
                </div>
                <div>
                  <label className={labelClass}><span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> 电话 <span className="text-red-400">*</span></span></label>
                  <input required type="tel" placeholder="138 0000 0000"
                    value={form.phone} onChange={(e) => setForm(form => ({...form, phone: e.target.value }))}
                    className={inputClass(!form.phone)} />
                </div>
                <div>
                  <label className={labelClass}><span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> 单位/机构 <span className="text-red-400">*</span></span></label>
                  <input required type="text" placeholder="上海生物化学研究所"
                    value={form.institution} onChange={(e) => setForm(form => ({...form, institution: e.target.value }))}
                    className={inputClass(!form.institution)} />
                </div>
                <div>
                  <label className={labelClass}>部门</label>
                  <input type="text" placeholder="细胞生物学实验室"
                    value={form.department} onChange={(e) => setForm(form => ({...form, department: e.target.value }))}
                    className={inputClass(false)} />
                </div>
              </div>

              {savedAddresses.length > 0 && (
                <div>
                  <label className={labelClass}>已保存的收货地址</label>
                  <select
                    value={selectedAddressId}
                    onChange={(e) => {
                      const address = savedAddresses.find(item => item.id === e.target.value);
                      if (address) {
                        applySavedAddress(address);
                      } else {
                        setSelectedAddressId('');
                      }
                    }}
                    className={`w-full px-3.5 py-2.5 text-sm ${uiSurfaces.input}`}
                  >
                    <option value="">手动填写当前收货信息</option>
                    {savedAddresses.map(address => (
                      <option key={address.id} value={address.id}>
                        {(address.label || '收货地址')} · {address.name} · {address.phone} · {address.address}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={labelClass}><span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> 通讯地址</span></label>
                <input type="text" placeholder="上海市浦东新区张江高科技园区..."
                  value={form.address} onChange={(e) => setForm(form => ({...form, address: e.target.value }))}
                  className={inputClass(false)} />
              </div>

              <div>
                <label className={labelClass}><span className="flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" /> 付款方式 <span className="text-red-400">*</span></span></label>
                <select
                  required
                  value={form.paymentMethod}
                  onChange={(e) => setForm(form => ({...form, paymentMethod: e.target.value }))}
                  className={`w-full px-3.5 py-2.5 text-sm ${uiSurfaces.input}`}
                >
                  <option value="">请选择付款方式（必填）</option>
                  <option value="对公转账">对公转账</option>
                  <option value="锐竞平台">锐竞平台</option>
                  <option value="喀斯玛平台">喀斯玛平台</option>
                </select>
              </div>

              <div>
                <label className={labelClass}><span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> 备注 / 特殊需求</span></label>
                <textarea rows={3} placeholder="如：需要 COA 文档、指定批号、催单等..."
                  value={form.notes} onChange={(e) => setForm(form => ({...form, notes: e.target.value }))}
                  className={`w-full resize-none px-3.5 py-2.5 text-sm ${uiSurfaces.input}`} />
              </div>

              {rateLimitError && (
                <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{rateLimitError}</div>
              )}

              <div className="pt-2">
                <button type="submit" disabled={submitting}
                  className={`${uiSurfaces.primaryButton} w-full py-3.5 disabled:bg-brand-300`}>
                  {submitting ? (
                    <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> 提交中...</>
                  ) : <><Send className="w-4 h-4" /> 提交询价请求</>}
                </button>
                <p className="text-xs text-gray-400 text-center mt-2">提交即表示您同意我们的 <a href="/privacy" className="text-brand-500 hover:underline">隐私政策</a> 和 <a href="/terms" className="text-brand-500 hover:underline">销售条款</a></p>
              </div>
            </form>
          </div>

          <div className="lg:col-span-1">
            <div className={`sticky top-20 rounded-[1.15rem] p-5 ${uiSurfaces.panelStrong}`}>
              <h3 className="font-semibold text-gray-800 mb-4">订单摘要</h3>
              <div className="space-y-2.5 mb-4 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">商品种类</span><span className="text-gray-700">{confirmedItems.length} 种</span></div>
                <div className="flex justify-between"><span className="text-gray-500">商品件数</span><span className="text-gray-700">{confirmedItems.reduce((sum, i) => sum + i.quantity, 0)} 件</span></div>
                <div className="flex justify-between"><span className="text-gray-500">运费</span><span className="text-brand-500">待客服确认</span></div>
              </div>
              <div className="border-t border-gray-100 pt-3 mb-5">
                <div className="flex justify-between font-bold text-lg"><span className="text-gray-800">合计</span><span className="text-brand-600">待报价</span></div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <MobileBottomNav />

      <SiteFooter />
    </div>
  );
}
