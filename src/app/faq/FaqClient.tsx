'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, FlaskConical, Zap, Droplets, Activity, Microscope, Layers, type LucideIcon } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import type { ExperimentFaqCategory } from '@/data/experiment-faqs';

const categoryPresentation: Record<string, { icon: LucideIcon; color: string; iconColor: string }> = {
  'cell-culture': { icon: FlaskConical, color: 'bg-rose-100/70', iconColor: 'text-rose-600' },
  'western-blot': { icon: Zap, color: 'bg-blue-100/70', iconColor: 'text-blue-600' },
  elisa: { icon: Droplets, color: 'bg-green-100/70', iconColor: 'text-green-600' },
  'flow-cytometry': { icon: Activity, color: 'bg-purple-100/70', iconColor: 'text-purple-600' },
  ihc: { icon: Microscope, color: 'bg-amber-100/70', iconColor: 'text-amber-600' },
  ip: { icon: Layers, color: 'bg-cyan-100/70', iconColor: 'text-cyan-600' },
};

export default function FaqClient({ categories }: { categories: ExperimentFaqCategory[] }) {
  const [openIdx, setOpenIdx] = useState<Record<number, number | null>>({});

  const toggle = (catIdx: number, faqIdx: number) => {
    setOpenIdx((prev) => ({
      ...prev,
      [catIdx]: prev[catIdx] === faqIdx ? null : faqIdx,
    }));
  };

  return (
    <>
      <AdaptiveHeader showNav={true} />

      <div className="min-h-screen libereal-service-page pb-16 lg:pb-0">
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">常见实验问题与解决方案</h1>
            <p className="text-sm text-gray-500 mt-0.5">覆盖细胞培养、Western Blot、ELISA、流式、IHC、免疫沉淀六大实验板块</p>
          </div>

          <div className="space-y-4">
            {categories.map(({ id, name, faqs }, catIdx) => {
              const presentation = categoryPresentation[id] ?? categoryPresentation['cell-culture'];
              const Icon = presentation.icon;
              return (
                <div key={id} className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl overflow-hidden shadow-xl shadow-black/5">
                  <div className="flex items-center gap-4 p-5 border-b border-white/30">
                    <div className={`p-2.5 rounded-xl ${presentation.color} backdrop-blur-sm`}>
                      <Icon className={`w-5 h-5 ${presentation.iconColor}`} />
                    </div>
                    <h2 className="flex-1 text-lg font-semibold text-gray-900">{name}</h2>
                    <span className="text-xs text-gray-400">{faqs.length} 个问题</span>
                  </div>

                  <div>
                    {faqs.map(({ q, a }, faqIdx) => {
                      const open = openIdx[catIdx] === faqIdx;
                      return (
                        <div key={q} className={`border-b border-gray-100/50 last:border-b-0 ${faqIdx !== 0 ? 'border-t border-white/30' : ''}`}>
                          <button
                            onClick={() => toggle(catIdx, faqIdx)}
                            className="w-full flex items-center justify-between p-5 hover:bg-white/50 transition-colors text-left"
                          >
                            <span className="font-semibold text-brand-700 pr-4">{q}</span>
                            {open
                              ? <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                              : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                            }
                          </button>
                          <div className="px-5 pb-5" hidden={!open}>
                            <p className="text-gray-600 leading-relaxed">{a}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 p-6 bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl text-center">
            <p className="text-sm text-gray-600 leading-relaxed">
              以上内容为通用实验技巧，具体问题可联系我们的技术支持团队：<br />
              <a href="mailto:support@libereal.cn" className="text-brand-600 hover:underline">support@libereal.cn</a>
            </p>
          </div>
        </main>
      </div>

      <MobileBottomNav />
      <SiteFooter />
    </>
  );
}
