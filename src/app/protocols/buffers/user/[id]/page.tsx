'use client';

import Image from 'next/image';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Beaker } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { RecipeContent, UserRecipe } from '@/components/community/types';

export default function UserBufferDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [recipe, setRecipe] = useState<UserRecipe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/user/recipes/public?id=${id}&type=buffer`)
      .then(r => r.json())
      .then(data => {
        if (data.recipe) setRecipe(data.recipe);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">配方未找到</h2>
          <Link href="/protocols" className="text-brand-600 hover:underline">返回方案库</Link>
        </div>
      </div>
    );
  }

  const content = recipe.content as RecipeContent;
  const displayName = recipe.wechatNickname || recipe.authorName || '匿名用户';

  return (
    <div className="min-h-screen libereal-service-page pb-16 lg:pb-0">
      <AdaptiveHeader showNav={true} />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Link
          href="/protocols"
          className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-lg bg-white/50 backdrop-blur-sm hover:bg-white/70 border border-gray-200/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-600">返回方案库</span>
        </Link>

        {/* Header */}
        <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-4 rounded-xl bg-emerald-50">
              <Beaker className="w-8 h-8 text-emerald-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{content.name}</h1>
                <span className="text-xs px-2 py-0.5 bg-brand-100 text-brand-700 rounded-full font-medium">
                  用户贡献
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-2">{content.category}</p>
              {content.description && (
                <p className="text-gray-600 mt-3 leading-relaxed">{content.description}</p>
              )}

              {/* Contributor info */}
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-medium flex-shrink-0 overflow-hidden">
                  {recipe.displayAvatarUrl ? (
                    <Image src={recipe.displayAvatarUrl} alt={displayName} width={32} height={32} className="w-full h-full object-cover" suppressHydrationWarning />
                  ) : (
                    displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">
                    贡献者：<span className="font-medium text-gray-900">{displayName}</span>
                  </p>
                  <p className="text-xs text-gray-400">分享于 {new Date(recipe.updatedAt).toLocaleDateString('zh-CN')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Components */}
        {content.components && content.components.length > 0 && content.components.some(c => c.name.trim()) && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">组分</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-600 font-medium">名称</th>
                  <th className="text-left py-2 text-gray-600 font-medium">用量</th>
                  <th className="text-left py-2 text-gray-600 font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {content.components.filter(c => c.name.trim()).map((comp, idx) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-2 text-gray-800">{comp.name}</td>
                    <td className="py-2 text-gray-700 font-mono text-xs">{comp.amount}</td>
                    <td className="py-2 text-gray-500 text-xs">{comp.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Preparation */}
        {content.preparation && content.preparation.length > 0 && content.preparation.some(p => p.trim()) && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">配制步骤</h2>
            <ol className="space-y-3">
              {content.preparation.filter(p => p.trim()).map((step, idx) => (
                <li key={idx} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-gray-600 leading-relaxed pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Storage */}
        {content.storage && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">储存方式</h2>
            <p className="text-gray-600">{content.storage}</p>
          </div>
        )}

        {/* Notes */}
        {content.notes && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">备注</h2>
            <p className="text-gray-600 whitespace-pre-wrap">{content.notes}</p>
          </div>
        )}

        {/* Related Products */}
        {content.relatedProducts && content.relatedProducts.length > 0 && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">相关产品</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {content.relatedProducts.map((product, idx) => (
                <Link
                  key={idx}
                  href={`/products?search=${product.code}`}
                  className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-xl border border-gray-100/50 hover:border-brand-200/50 hover:bg-white/50 transition-all"
                >
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                    <span className="text-xs font-mono text-gray-400">{product.code}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{product.name}</p>
                    <p className="text-xs text-gray-400">{product.cat || product.code}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
