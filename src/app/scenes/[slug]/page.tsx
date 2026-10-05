import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Activity, ArrowLeft, CheckCircle2, Dna, Droplets, Library, LineChart, ListChecks, Microscope, Package, Wrench } from 'lucide-react';
import AdaptiveHeaderWithProductSearch from '@/components/AdaptiveHeaderWithProductSearch';
import JsonLd from '@/components/JsonLd';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SceneAnchorScroll from '@/components/scenes/SceneAnchorScroll';
import SceneBundleSelector from '@/components/scenes/SceneBundleSelector';
import SceneHashLink from '@/components/scenes/SceneHashLink';
import SceneDifficultyWorkbench from '@/components/scenes/SceneDifficultyWorkbench';
import SceneElisaCalculator from '@/components/scenes/SceneElisaCalculator';
import SceneFlowSpectrumViewer from '@/components/scenes/SceneFlowSpectrumViewer';
import ScenePrepListBuilder from '@/components/scenes/ScenePrepListBuilder';
import SceneProductDecisionHub from '@/components/scenes/SceneProductDecisionHub';
import SceneResourceExplorer from '@/components/scenes/SceneResourceExplorer';
import SceneWorkflowNavigator from '@/components/scenes/SceneWorkflowNavigator';
import SiteFooter from '@/components/SiteFooter';
import { getSceneBySlug, scenes } from '@/data/scenes';
import { buildBreadcrumbListJsonLd } from '@/lib/seo/json-ld';
import { getSceneTheme } from '@/lib/scene-theme';
import { getSceneUiCopy } from '@/lib/scene-ui-copy';
import { canonicalSiteUrl } from '@/lib/site-url';

const heroIconsBySlug: Record<string, Array<typeof Package>> = {
  elisa: [Package, LineChart, Wrench],
  ihc: [Microscope, ListChecks, Wrench],
  immunofluorescence: [Droplets, ListChecks, Wrench],
  'flow-cytometry': [Activity, LineChart, ListChecks, Wrench],
  'small-animal-imaging': [Microscope, Activity, LineChart, Wrench],
  'molecular-biology': [Dna, ListChecks, Wrench],
  'western-blot': [Package, ListChecks, Wrench],
};

const heroFocusRingBySlug: Record<string, string> = {
  elisa: 'focus-visible:ring-green-500/70',
  ihc: 'focus-visible:ring-rose-500/70',
  immunofluorescence: 'focus-visible:ring-purple-500/70',
  'flow-cytometry': 'focus-visible:ring-amber-500/70',
  'small-animal-imaging': 'focus-visible:ring-sky-500/70',
  'molecular-biology': 'focus-visible:ring-cyan-500/70',
  'western-blot': 'focus-visible:ring-blue-500/70',
};

function HeroHighlightCard({
  highlight,
  theme,
  index,
  sceneSlug,
}: {
  highlight: { title: string; description: string; href?: string };
  theme: ReturnType<typeof getSceneTheme>;
  index: number;
  sceneSlug: string;
}) {
  const icons = heroIconsBySlug[sceneSlug] ?? [Package, LineChart, Wrench];
  const StepIcon = icons[index] ?? CheckCircle2;
  const focusRing = heroFocusRingBySlug[sceneSlug] ?? 'focus-visible:ring-slate-400/70';
  const inner = (
    <>
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${theme.stepBadge}`}>
        <StepIcon className={`h-4 w-4 ${theme.stepIcon}`} />
      </span>
      <div>
        <p className="text-sm font-semibold text-gray-900">{highlight.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">{highlight.description}</p>
      </div>
    </>
  );

  if (highlight.href) {
    return (
      <SceneHashLink
        href={highlight.href}
        className={`flex gap-3 rounded-xl bg-white/90 p-3 shadow-sm transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 ${focusRing}`}
      >
        {inner}
      </SceneHashLink>
    );
  }

  return <div className="flex gap-3 rounded-xl bg-white/90 p-3 shadow-sm">{inner}</div>;
}

export function generateStaticParams() {
  return scenes.map((scene) => ({ slug: scene.slug }));
}

type ScenePageProps = {
  params: Promise<{ slug: string }>;
};

const sceneDescriptionBySlug: Record<string, string> = {
  elisa: 'ELISA 检测工作台：试剂盒选型、4PL 浓度回算、材料准备与疑难排查。',
  'elispot-fluorospot': 'ELISpot / FluoroSpot 工作台：细胞分泌功能检测、孔位设计、spot 计数、背景扣除和质控判断。',
  ihc: 'IHC 免疫组化工作台：抗体选型、抗原修复、检测显色、材料准备与疑难排查。',
  immunofluorescence: '免疫荧光工作台：抗体选型、通道规划、荧光染色、材料准备与疑难排查。',
  'flow-cytometry': '流式细胞术工作台：panel 设计、样本制备、补偿对照、材料准备与疑难排查。',
  'magnetic-cell-separation': '免疫磁珠分选工作台：正选、负选、去除法、预富集后 FACS、纯度活率质控和下游衔接。',
  'single-cell-omics': '单细胞组学工作台：样本制备、细胞富集、建库前质控、公共图谱和分析工具。',
  'spatial-biology': '空间生物学工作台：组织切片、空间检测、多重染色、图像配准和空间组学分析。',
  'small-animal-imaging': '小动物实验与成像工作台：动物模型、活体成像、麻醉监测、探针给药、图像定量和材料准备。',
  'organoid-3d-culture': '类器官与 3D 细胞培养工作台：ECM、培养体系、生长因子、药筛读数和成像分析。',
  'crispr-gene-editing': 'CRISPR 基因编辑工作台：sgRNA 设计、编辑递送、筛选鉴定、脱靶评估和功能验证。',
  'extracellular-vesicles': '细胞外囊泡研究工作台：EV 分离富集、粒径浓度、marker 表征、公共规范和功能验证。',
  'proteomics-mass-spec': '蛋白组学与质谱分析工作台：样本制备、酶解脱盐、质谱数据分析、公共数据库和候选验证。',
  'molecular-biology': '分子生物学工作台：核酸提取、PCR/qPCR、克隆转染、材料准备与疑难排查。',
  'western-blot': 'Western Blot 实验工作台：抗体选型、材料准备与疑难排查。',
};

export async function generateMetadata({ params }: ScenePageProps): Promise<Metadata> {
  const { slug } = await params;
  const scene = getSceneBySlug(slug);
  if (!scene) return {};
  const description = sceneDescriptionBySlug[slug] ?? `${scene.title} 配套采购、疑难协助与询价支持。`;
  return {
    title: `${scene.title} 应用场景`,
    description,
    alternates: {
      canonical: canonicalSiteUrl(`/scenes/${scene.slug}`),
    },
  };
}

export default async function ScenePage({ params }: ScenePageProps) {
  const { slug } = await params;
  const scene = getSceneBySlug(slug);
  if (!scene) notFound();

  const Icon = scene.icon;
  const theme = getSceneTheme(scene.slug);
  const ui = getSceneUiCopy(scene.slug);
  const heroHeading = ui.heroTitle ?? scene.title;
  const isWorkbench = Boolean(ui.workflow && ui.decisions);
  const scrollSectionClass = '';
  const isElisa = scene.slug === 'elisa';
  const isFlowCytometry = scene.slug === 'flow-cytometry';

  return (
    <div className={`relative isolate min-h-screen overflow-hidden flex flex-col ${theme.pageBg}`}>
      <JsonLd
        data={buildBreadcrumbListJsonLd([
          { name: '首页', path: '/' },
          { name: '应用与场景', path: '/scenes' },
          { name: scene.title },
        ])}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 top-[42%] z-0 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(245,243,255,0.78)_38%,rgba(221,214,254,1)_100%)] dark:bg-[linear-gradient(180deg,rgba(76,29,149,0)_0%,rgba(76,29,149,0.34)_38%,rgba(49,46,129,0.62)_100%)]"
        aria-hidden
      />
      {isWorkbench ? <SceneAnchorScroll /> : null}
      <AdaptiveHeaderWithProductSearch showNav />
      <main className="relative z-10 flex-1 mx-auto w-full max-w-6xl px-4 py-8 pb-24 lg:pb-10">
        <div className="mb-5">
          <Link href="/" className={`inline-flex items-center gap-1 text-sm text-gray-500 ${theme.backLinkHover}`}>
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
        </div>

        <section className={`relative mb-6 overflow-hidden rounded-2xl border shadow-sm ${theme.heroBorder}`}>
          {theme.heroIllustration ? (
            <div className="relative z-10 grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="relative min-h-[320px] lg:min-h-[360px]">
                <Image
                  src={theme.heroIllustration}
                  alt={scene.slug === 'elisa'
                    ? '科研人员使用多道移液器向 ELISA 微孔板加样'
                    : `${scene.title}实验场景示意图`}
                  fill
                  priority
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 55vw"
                />
                <div className="relative z-10 flex min-h-[320px] flex-col justify-start p-4 sm:min-h-[360px] sm:p-5">
                  <div className={`max-w-sm rounded-xl border p-3.5 backdrop-blur-sm sm:p-4 ${theme.heroGlassPanel}`}>
                    <div className={`mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-2.5 py-0.5 text-xs font-medium ${theme.heroGlassEyebrow}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {scene.eyebrow}
                    </div>
                    <h1 className={`text-3xl font-bold sm:text-4xl ${theme.heroGlassTitle}`}>{heroHeading}</h1>
                    <p className={`mt-1.5 line-clamp-2 text-sm leading-relaxed ${theme.heroGlassSummary}`}>{scene.summary}</p>
                  </div>
                </div>
              </div>

              <div className={`relative border-t border-slate-100/80 p-5 sm:p-6 backdrop-blur-[1px] lg:border-l lg:border-t-0 ${theme.heroAsideBg}`}>
                <div
                  className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${theme.heroImage})` }}
                  aria-hidden
                />
                <div className={`pointer-events-none absolute inset-0 ${theme.heroOverlay}`} aria-hidden />
                <div className="relative z-10 space-y-3">
                  {ui.heroHighlights.map((highlight, index) => (
                    <HeroHighlightCard key={highlight.title} highlight={highlight} theme={theme} index={index} sceneSlug={scene.slug} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div
                className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${theme.heroImage})` }}
                aria-hidden
              />
              <div className={`pointer-events-none absolute inset-0 ${theme.heroOverlay}`} aria-hidden />
              <div className="relative z-10 grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
                    <div className="min-w-0 flex-1">
                      <div className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${scene.accentClass}`}>
                        <Icon className="h-4 w-4" />
                        {scene.eyebrow}
                      </div>
                      <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">{heroHeading}</h1>
                      <p className="mt-3 max-w-2xl text-base leading-relaxed text-gray-600">{scene.summary}</p>
                    </div>
                  </div>
                </div>

                <div className={`border-t border-slate-100/80 p-5 sm:p-6 backdrop-blur-[1px] lg:border-l lg:border-t-0 ${theme.heroAsideBg}`}>
                  <div className="space-y-3">
                    {ui.heroHighlights.map((highlight, index) => (
                      <HeroHighlightCard key={highlight.title} highlight={highlight} theme={theme} index={index} sceneSlug={scene.slug} />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        {isWorkbench && ui.workflow ? (
          <div id="workflow" className={scrollSectionClass}>
            <SceneWorkflowNavigator workflow={scene.workflow} theme={theme} ui={ui.workflow} />
          </div>
        ) : null}

        {isElisa && ui.calculatorGuide ? (
          <div id="elisa-calculator" className={scrollSectionClass}>
            <SceneElisaCalculator theme={theme} guide={ui.calculatorGuide} />
          </div>
        ) : null}

        {isWorkbench && ui.decisions ? (
          <div id="product-decisions" className={scrollSectionClass}>
            <SceneProductDecisionHub
              decisionPoints={scene.decisionPoints}
              fallbackProductLinks={scene.productLinks}
              theme={theme}
              ui={ui.decisions}
            />
          </div>
        ) : null}

        {isFlowCytometry ? (
          <div id="spectrum-viewer" className={scrollSectionClass}>
            <SceneFlowSpectrumViewer theme={theme} />
          </div>
        ) : null}

        <div id={isWorkbench ? 'prep-assistant' : undefined} className={isWorkbench ? scrollSectionClass : undefined}>
          <ScenePrepListBuilder sceneSlug={scene.slug} theme={theme} ui={ui.prep} />
        </div>

        <div id={isWorkbench ? 'bundle-selector' : undefined} className={isWorkbench ? scrollSectionClass : undefined}>
          <SceneBundleSelector bundles={scene.bundles} theme={theme} sceneTitle={scene.title} />
        </div>

        <div id={isWorkbench ? 'difficulty' : undefined} className={isWorkbench ? scrollSectionClass : undefined}>
          <SceneDifficultyWorkbench difficulties={scene.difficulties} theme={theme} ui={ui.difficulty} />
        </div>

        <div id={isWorkbench ? 'support' : undefined} className={isWorkbench ? scrollSectionClass : undefined}>
          <SceneResourceExplorer
            protocols={scene.protocols}
            analysisSoftware={scene.analysisSoftware}
            supportLinks={scene.supportLinks}
            brands={scene.brands}
            theme={theme}
            ui={ui.resources}
          />
        </div>

        <section id="faq" className="mb-8 scroll-mt-site-header rounded-2xl border border-slate-200 bg-white p-5 shadow-sm scroll-mt-site-header">
          <div className="mb-4 flex items-center gap-2">
            <Library className={`h-5 w-5 ${theme.sectionIcon}`} />
            <h2 className="text-lg font-semibold text-gray-900">{ui.faqTitle}</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {scene.faqs.map((faq) => (
              <div key={faq.question} className="rounded-xl border border-gray-100 bg-white p-3">
                <p className="text-sm font-medium text-gray-900">{faq.question}</p>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <div className="relative z-10">
        <SiteFooter />
      </div>
      <MobileBottomNav />
    </div>
  );
}
