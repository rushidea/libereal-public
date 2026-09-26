import ResearchLifeCarousel from '@/components/home/ResearchLifeCarousel';
import ResearchLifeMosaic from '@/components/home/ResearchLifeMosaic';

export default function HomeVisionPlaygroundPage() {
  return (
    <main className="min-h-screen bg-[#edf4f1] px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 border-b border-slate-300/70 pb-6">
          <p className="text-xs font-semibold text-brand-700">LIBEREAL HOME</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">首页科研生活 Hero</h1>
        </header>

        <div className="space-y-12 sm:space-y-16">
          <section aria-labelledby="vision-with-labels">
            <h2 id="vision-with-labels" className="mb-3 text-sm font-semibold text-slate-700">
              版本 A · 显示活动名称
            </h2>
            <ResearchLifeCarousel
              showActivityName
              ariaLabel="显示活动名称的科研生活照片轮播"
            />
          </section>

          <section aria-labelledby="vision-without-labels">
            <h2 id="vision-without-labels" className="mb-3 text-sm font-semibold text-slate-700">
              版本 B · 纯图片
            </h2>
            <ResearchLifeCarousel
              showActivityName={false}
              ariaLabel="纯图片科研生活照片轮播"
            />
          </section>

          <section aria-labelledby="vision-mosaic">
            <h2 id="vision-mosaic" className="mb-3 text-sm font-semibold text-slate-700">
              版本 C · 中央大图与四周小图
            </h2>
            <ResearchLifeMosaic />
          </section>
        </div>
      </div>
    </main>
  );
}
