'use client';

import Image from 'next/image';

import { useState } from 'react';
import { ShoppingCart, Lock, Package } from 'lucide-react';
import { PRODUCT_CATEGORY_LABELS, PRODUCT_CATEGORY_COLORS, ProductCategory, formatPoints } from '@/lib/points';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface Variant {
  name: string;
  cost: number;
}

interface PointsProduct {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  pointsCost: number;
  stock: number;
  metadata: string | null;
}

interface Props {
  product: PointsProduct;
  userPoints: number;
  onRedeem: (product: PointsProduct, variantIndex?: number) => void;
}

function parseVariants(metadata: string | null): Variant[] {
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

export default function PointsProductCard({ product, userPoints, onRedeem }: Props) {
  const variants = parseVariants(product.metadata);
  const hasVariants = variants.length > 0;
  const [selected, setSelected] = useState(0);

  const activeCost = hasVariants ? variants[selected].cost : product.pointsCost;
  const canAfford = userPoints >= activeCost;
  const inStock = product.stock === -1 || product.stock > 0;

  return (
    <div className={`${uiSurfaces.panel} rounded-brand overflow-hidden border-[var(--surface-border)] shadow-[var(--shadow-panel)] transition-all hover:shadow-[var(--shadow-panel-strong)]`}>
      {/* Image area */}
      <div className="h-36 bg-gradient-to-br from-emerald-50/60 to-violet-100/60 flex items-center justify-center relative">
        {product.imageUrl ? (
          <Image src={product.imageUrl} alt={product.name} width={300} height={144} className="w-full h-full object-cover" suppressHydrationWarning />
        ) : (
          <div className="text-emerald-300">
            <Package className="w-12 h-12" />
          </div>
        )}
        <span className={`absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-medium ${PRODUCT_CATEGORY_COLORS[product.category as ProductCategory] || 'bg-gray-100 text-gray-700'}`}>
          {PRODUCT_CATEGORY_LABELS[product.category as ProductCategory] || product.category}
        </span>
        {product.stock !== -1 && (
          <span className={`absolute right-2 top-2 rounded-brand px-2 py-0.5 text-xs font-medium ${uiSurfaces.panelStrong} ${uiSurfaces.textSecondary}`}>
            库存 {product.stock}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className={`mb-1 line-clamp-1 font-bold ${uiSurfaces.titleText}`}>{product.name}</h3>
        {product.description && (
          <p className={`mb-2 h-8 line-clamp-2 text-xs ${uiSurfaces.mutedText}`}>{product.description}</p>
        )}

        {/* Variant picker */}
        {hasVariants && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {variants.map((v, i) => (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                  selected === i
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white/60'
                }`}
              >
                {v.name} <span className="opacity-70">{v.cost}分</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-2">
          <div>
            <div className={`text-xs ${uiSurfaces.mutedText}`}>所需积分</div>
            <div className="text-lg font-bold text-violet-600">{formatPoints(activeCost)}</div>
          </div>
          <button
            onClick={() => onRedeem(product, hasVariants ? selected : undefined)}
            disabled={!canAfford || !inStock}
            className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors ${
              !canAfford || !inStock
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
            title={!canAfford ? '积分不足' : !inStock ? '已售罄' : '兑换'}
          >
            {!canAfford ? <Lock className="w-3.5 h-3.5" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            兑换
          </button>
        </div>
        {!canAfford && (
          <p className={`mt-2 text-xs ${uiSurfaces.statusError}`}>还差 {formatPoints(activeCost - userPoints)} 积分</p>
        )}
        {!inStock && (
          <p className={`mt-2 text-xs ${uiSurfaces.mutedText}`}>已售罄</p>
        )}
      </div>
    </div>
  );
}
