'use client';

import Image from 'next/image';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, AlertTriangle, Heart, User } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { ProtocolContent, UserRecipe } from '@/components/community/types';

const difficultyColors: Record<string, string> = {
  '基础': 'bg-green-100 text-green-700',
  '中级': 'bg-amber-100 text-amber-700',
  '高级': 'bg-red-100 text-red-700',
};

export default function UserProtocolDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [recipe, setRecipe] = useState<UserRecipe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/user/recipes/public?id=${id}&type=protocol`)
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
          <h2 className="text-xl font-semibold text-gray-700 mb-2">方案未找到</h2>
          <Link href="/protocols" className="text-brand-600 hover:underline">返回方案库</Link>
        </div>
      </div>
    );
  }

  const content = recipe.content as ProtocolContent;
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
            <div className="p-4 rounded-xl bg-brand-50">
              <User className="w-8 h-8 text-brand-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{content.title}</h1>
                <span className="text-xs px-2 py-0.5 bg-brand-100 text-brand-700 rounded-full font-medium">
                  用户贡献
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${difficultyColors[content.difficulty]}`}>
                  {content.difficulty}
                </span>
                <span className="text-sm text-gray-500">{content.category}</span>
                {content.duration && (
                  <>
                    <span className="text-sm text-gray-400">·</span>
                    <span className="text-sm text-gray-400">{content.duration}</span>
                  </>
                )}
              </div>
              <p className="text-gray-600 mt-3 leading-relaxed">{content.description}</p>

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

        {/* Steps */}
        {content.steps && content.steps.length > 0 && content.steps.some(s => s.trim()) && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 text-sm font-bold flex items-center justify-center">1</span>
              实验步骤
            </h2>
            <ol className="space-y-3">
              {content.steps.filter(s => s.trim()).map((step, idx) => (
                <li key={idx} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-gray-600 leading-relaxed pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Tips */}
        {content.tips && content.tips.length > 0 && content.tips.some(t => t.trim()) && (
          <div className="bg-amber-50/50 backdrop-blur-md border border-amber-200/50 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              注意事项
            </h2>
            <ul className="space-y-2">
              {content.tips.filter(t => t.trim()).map((tip, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-gray-600">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Related Products */}
        {content.relatedProducts && content.relatedProducts.length > 0 && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-500" />
              相关产品
            </h2>
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
                    <p className="text-xs text-gray-400">{product.cat}</p>
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
