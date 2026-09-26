'use client';

import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Beaker } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { getBufferById } from '@/data/buffers-detail';

export default function BufferDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  
  const buffer = getBufferById(id);
  
  const backParams = searchParams.toString();

  if (!buffer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">缓冲液未找到</h2>
          <Link href="/protocols" className="text-brand-600 hover:underline">返回方案库</Link>
        </div>
      </div>
    );
  }

  const Icon = buffer.icon;

  return (
    <div className="min-h-screen libereal-service-page pb-16 lg:pb-0">
      <AdaptiveHeader showNav={true} />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Back Button */}
        <Link
          href={`/protocols${backParams ? `?${backParams}` : ''}`}
          className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-lg bg-white/50 backdrop-blur-sm hover:bg-white/70 border border-gray-200/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-600">返回方案库</span>
        </Link>

        {/* Header */}
        <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className={`p-4 rounded-xl ${buffer.bgColor}`}>
              <Icon className={`w-8 h-8 ${buffer.iconColor}`} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900">{buffer.name}</h1>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-sm px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                  {buffer.category}
                </span>
              </div>
              <p className="text-gray-600 mt-3 leading-relaxed">{buffer.description}</p>
            </div>
          </div>
        </div>

        {/* Components */}
        <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 text-sm font-bold flex items-center justify-center">1</span>
            配方成分
          </h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-sm font-medium text-gray-500">成分</th>
                <th className="text-right py-2 text-sm font-medium text-gray-500">用量</th>
              </tr>
            </thead>
            <tbody>
              {buffer.components.map((comp, idx) => (
                <tr key={idx} className="border-b border-gray-100 last:border-0">
                  <td className="py-2.5 text-sm text-gray-700">{comp.name}</td>
                  <td className="py-2.5 text-sm text-gray-600 text-right font-mono">{comp.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Preparation */}
        <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 text-sm font-bold flex items-center justify-center">2</span>
            配制步骤
          </h2>
          <ol className="space-y-3">
            {buffer.preparation.map((step, idx) => (
              <li key={idx} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center">
                  {idx + 1}
                </span>
                <span className="text-gray-600 leading-relaxed pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Storage */}
        {buffer.storage && (
          <div className="bg-blue-50/50 backdrop-blur-md border border-blue-200/50 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <Beaker className="w-5 h-5 text-blue-500" />
              保存条件
            </h2>
            <p className="text-gray-600">{buffer.storage}</p>
          </div>
        )}

        {/* Notes */}
        {buffer.notes && buffer.notes.length > 0 && (
          <div className="bg-amber-50/50 backdrop-blur-md border border-amber-200/50 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-amber-500">💡</span>
              注意事项
            </h2>
            <ul className="space-y-2">
              {buffer.notes.map((note, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-2" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}