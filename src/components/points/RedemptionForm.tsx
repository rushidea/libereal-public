'use client';

import { useState } from 'react';
import { X, MapPin } from 'lucide-react';
import { formatPoints } from '@/lib/points';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface Variant {
  name: string;
  cost: number;
}

interface Product {
  id: string;
  name: string;
  category: string;
  pointsCost: number;
  metadata?: string | null;
}

interface Props {
  product: Product;
  variantIndex?: number;
  onConfirm: (shippingInfo?: { name: string; phone: string; address: string }, variantIndex?: number) => Promise<void>;
  onCancel: () => void;
}

function parseVariants(metadata: string | null | undefined): Variant[] {
  if (!metadata) return [];
  try {
    const meta = JSON.parse(metadata);
    if (Array.isArray(meta.variants)) {
      return meta.variants
        .filter((v: unknown): v is { name: string; cost: number } => !!v && typeof (v as Record<string, unknown>).name === 'string' && typeof (v as Record<string, unknown>).cost === 'number')
        .slice(0, 3);
    }
  } catch {}
  return [];
}

export default function RedemptionForm({ product, variantIndex, onConfirm, onCancel }: Props) {
  const requiresShipping = product.category === 'physical';
  const variants = parseVariants(product.metadata);
  const activeVariant = variantIndex !== undefined && variants[variantIndex] ? variants[variantIndex] : null;
  const activeCost = activeVariant ? activeVariant.cost : product.pointsCost;
  const activeName = activeVariant ? activeVariant.name : null;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (requiresShipping) {
      if (!name.trim() || !phone.trim() || !address.trim()) {
        setError('请完整填写收货信息');
        return;
      }
    }
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(
        requiresShipping ? { name: name.trim(), phone: phone.trim(), address: address.trim() } : undefined,
        variantIndex
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '兑换失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`${uiSurfaces.overlay} ${uiSurfaces.modalBackdrop}`}>
      <div className={`${uiSurfaces.modal} w-full max-w-md rounded-brand p-6 shadow-[var(--shadow-panel-strong)]`}>
        <div className="flex items-start justify-between mb-4">
          <h3 className={`text-lg font-bold ${uiSurfaces.titleText}`}>确认兑换</h3>
          <button onClick={onCancel} className={`rounded-brand p-1 ${uiSurfaces.mutedText} hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-violet-100 rounded-xl p-4 mb-4">
          <p className={`text-sm ${uiSurfaces.textSecondary}`}>商品</p>
          <p className={`mb-2 font-bold ${uiSurfaces.titleText}`}>
            {product.name}
            {activeName && <span className="ml-1.5 text-xs font-normal text-violet-600 bg-white/70 px-1.5 py-0.5 rounded">{activeName}</span>}
          </p>
          <div className="flex items-baseline gap-1">
            <span className={`text-xs ${uiSurfaces.mutedText}`}>消耗</span>
            <span className="text-2xl font-bold text-violet-600">{formatPoints(activeCost)}</span>
            <span className={`text-sm ${uiSurfaces.mutedText}`}>积分</span>
          </div>
        </div>

        {requiresShipping && (
          <div className="space-y-3 mb-4">
            <p className={`flex items-center gap-1.5 text-sm font-medium ${uiSurfaces.text}`}>
              <MapPin className="w-3.5 h-3.5" /> 收货信息（实物需要）
            </p>
            <div>
              <label className={`mb-1 block text-xs ${uiSurfaces.textSecondary}`}>收件人</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="姓名" className={`w-full ${uiSurfaces.input} rounded-brand px-3 py-2 text-sm ${uiSurfaces.focusRing}`} />
            </div>
            <div>
              <label className={`mb-1 block text-xs ${uiSurfaces.textSecondary}`}>联系电话</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="手机号" className={`w-full ${uiSurfaces.input} rounded-brand px-3 py-2 text-sm ${uiSurfaces.focusRing}`} />
            </div>
            <div>
              <label className={`mb-1 block text-xs ${uiSurfaces.textSecondary}`}>收货地址</label>
              <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2}
                placeholder="详细地址（省市区+街道+门牌号）" className={`w-full ${uiSurfaces.input} rounded-brand px-3 py-2 text-sm ${uiSurfaces.focusRing}`} />
            </div>
          </div>
        )}

        {!requiresShipping && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-4 text-xs text-violet-700">
            <p className="font-medium mb-1">数字商品说明</p>
            <p>兑换成功后，相应权益将自动发放到您的账户，无需物流。</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onCancel}
            className={`min-h-11 flex-1 rounded-brand border ${uiSurfaces.border} py-2.5 text-sm font-medium ${uiSurfaces.text} hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}>
            取消
          </button>
          <button onClick={handleConfirm} disabled={submitting}
            className={`min-h-11 flex-1 rounded-brand py-2.5 text-sm font-medium ${uiSurfaces.primaryButton} ${uiSurfaces.focusRing} disabled:opacity-50`}>
            {submitting ? '处理中...' : '确认兑换'}
          </button>
        </div>
      </div>
    </div>
  );
}
