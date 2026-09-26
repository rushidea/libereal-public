import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Compass,
  ExternalLink,
  Library,
  PackageCheck,
  Route,
  Search,
  Wrench,
} from 'lucide-react';
import AdaptiveHeaderWithProductSearch from '@/components/AdaptiveHeaderWithProductSearch';
import HomeSectionHeader from '@/components/home/HomeSectionHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { scenes, type SceneDefinition, type SceneResource } from '@/data/scenes';
import { getSceneTheme } from '@/lib/scene-theme';
import { getToolFaviconSrc } from '@/lib/tool-favicon';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '应用与场景',
  description: '按实验类型浏览工作流程、公共工具与采购支持，覆盖蛋白检测、细胞分析、基因编辑等科研场景。',
  alternates: {
    canonical: canonicalSiteUrl('/scenes'),
  },
};

const sceneGroups = [
  {
    title: '蛋白与免疫检测',
    slugs: ['western-blot', 'elisa', 'elispot-fluorospot', 'ihc', 'immunofluorescence'],
  },
  {
    title: '细胞分析',
    slugs: ['magnetic-cell-separation', 'flow-cytometry', 'single-cell-omics', 'extracellular-vesicles'],
  },
  {
    title: '空间与成像',
    slugs: ['spatial-biology', 'small-animal-imaging'],
  },
  {
    title: '模型与培养',
    slugs: ['organoid-3d-culture'],
  },
  {
    title: '基因功能与组学',
    slugs: ['crispr-gene-editing', 'proteomics-mass-spec'],
  },
  {
    title: '分子生物学',
    slugs: ['molecular-biology'],
  },
] as const;

const actionCards = [
  {
    title: '实验流程',
    href: '#scene-map',
    icon: Route,
  },
  {
    title: '公共工具',
    href: '#public-tools',
    icon: Wrench,
  },
  {
    title: '采购支持',
    href: '/inquiry',
    icon: PackageCheck,
  },
] as const;

const quickLinks = [
  { label: '实验支持', href: '/support', icon: BookOpen },
  { label: '实验方案', href: '/protocols', icon: Library },
  { label: '产品目录', href: '/products', icon: Search },
] as const;

const featuredSceneSlugs = ['western-blot', 'elisa', 'flow-cytometry', 'molecular-biology'] as const;

function isExternalHref(href: string) {
  return href.startsWith('http://') || href.startsWith('https://');
}

function getToolIconSrc(tool: SceneResource) {
  return getToolFaviconSrc(tool.href, tool.iconUrl);
}

function sceneBySlug(slug: string) {
  return scenes.find((scene) => scene.slug === slug);
}

function getSceneImage(scene: SceneDefinition) {
  return getSceneTheme(scene.slug).heroIllustration ?? getSceneTheme(scene.slug).heroImage;
}

const siteRecommendedTools: Array<SceneResource & { sceneTitle: string }> = [
  {
    label: 'Mole',
    href: 'https://mole.fit/?atp=libereal',
    description: '原生 macOS 系统工具，集清理、卸载、优化、磁盘分析与系统监控于一体。',
    category: '本站推荐工具',
    iconUrl: '/images/tool-favicons/mole.fit.png',
    sceneTitle: '本站推荐',
  },
];

function getUniqueTools() {
  const seen = new Set<string>();
  const fromScenes = scenes.flatMap((scene) =>
    (scene.analysisSoftware ?? []).flatMap((tool) => {
      const key = `${tool.label}-${tool.href}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...tool, sceneTitle: tool.contextLabel ?? scene.title }];
    }),
  );
  const recommended = siteRecommendedTools.filter((tool) => {
    const key = `${tool.label}-${tool.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...fromScenes, ...recommended];
}

type ToolLayoutGroup = {
  title: string;
  categories: readonly string[];
};

const toolLayoutGroups: ToolLayoutGroup[] = [
  {
    title: '抗体验证与选型',
    categories: ['抗体验证与选型', '蛋白表达与抗体验证', '抗原和表位资源', '免疫数据资源', '细胞 marker 参考'],
  },
  {
    title: '细胞图谱与流式分析',
    categories: ['公共细胞图谱', '单细胞分析', '细胞注释', 'FCS 数据分析', '流式数据参考', '流式数据资源'],
  },
  {
    title: '图像与空间分析',
    categories: [
      '图像与 ROI',
      '图像分析',
      '图像定量',
      '图像数据',
      '图像数据管理',
      '图像查看',
      '组织图像',
      '组织图像分析',
      '通用图像分析',
      '三维影像',
      '细胞图像分析',
      '类器官分析',
      '空间组学分析',
    ],
  },
  {
    title: '序列、引物与基因编辑',
    categories: ['序列查询', '引物检查', '引物设计', '克隆构建', 'RNA 调控与靶标', '基因编辑', 'sgRNA 设计', '脱靶评估', '编辑结果分析'],
  },
  {
    title: '蛋白结构、设计与分子发现',
    categories: [
      '蛋白结构与相互作用',
      '冷冻电镜数据与分析',
      '蛋白设计与工程',
      '化合物与生物活性数据',
      'AI 分子建模与化学信息学',
      '分子对接与虚拟筛选',
    ],
  },
  {
    title: '蛋白质组与公共数据',
    categories: [
      '蛋白数据库',
      '公共数据归档',
      '质谱数据分析',
      '靶向质谱验证',
      'EV 数据库',
      'EV 规范与记录',
    ],
  },
  {
    title: '实验参考与计算工具',
    categories: ['实验参考', '条带定量', '站内计算器'],
  },
  {
    title: '其他资源',
    categories: ['本站推荐工具', '项目支持'],
  },
];

type ToolGroup = {
  title: string;
  items: Array<SceneResource & { sceneTitle: string }>;
};

function groupToolsForLayout(tools: Array<SceneResource & { sceneTitle: string }>) {
  const assigned = new Set<string>();
  const groups = toolLayoutGroups.map((group) => ({
    title: group.title,
    items: tools.filter((tool) => {
      const key = `${tool.label}-${tool.href}`;
      const category = tool.category ?? '公共资源';
      if (assigned.has(key) || !group.categories.includes(category)) return false;
      assigned.add(key);
      return true;
    }),
  }));

  const remaining = tools.filter((tool) => !assigned.has(`${tool.label}-${tool.href}`));
  if (remaining.length > 0) {
    groups.push({ title: '其他公共资源', items: remaining });
  }

  return groups.filter((group) => group.items.length > 0);
}

function balanceToolColumns(groups: ToolGroup[]) {
  const columns: [ToolGroup[], ToolGroup[]] = [[], []];
  const estimatedHeights: [number, number] = [0, 0];

  for (const group of groups) {
    const target = estimatedHeights[0] <= estimatedHeights[1] ? 0 : 1;
    columns[target].push(group);
    estimatedHeights[target] += Math.ceil(group.items.length / 2) + 1;
  }

  return columns;
}

function SceneCard({ scene }: { scene: SceneDefinition }) {
  const imageSrc = getSceneImage(scene);

  return (
    <Link
      href={`/scenes/${scene.slug}`}
      className="group relative min-h-[12rem] overflow-hidden rounded-2xl border border-slate-200 shadow-sm shadow-slate-200/50 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-300/70 dark:shadow-slate-500/10 dark:hover:border-slate-400/70 dark:hover:shadow-slate-500/20"
    >
      <div className="absolute inset-0 bg-slate-100 dark:bg-slate-200">
        <Image
          src={imageSrc}
          alt={`${scene.title} 场景图`}
          fill
          className="object-cover transition-transform duration-700 group-hover:scale-105"
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      <div className="relative flex min-h-[12rem] flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-md">
            {scene.eyebrow}
          </span>
          <ArrowRight className="h-4 w-4 flex-shrink-0 text-white/70 transition group-hover:translate-x-0.5 group-hover:text-white" />
        </div>

        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">{scene.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/80 line-clamp-2">{scene.summary}</p>
        </div>
      </div>
    </Link>
  );
}

function FeaturedSceneCard({ scene }: { scene: SceneDefinition }) {
  const imageSrc = getSceneImage(scene);
  return (
    <Link
      href={`/scenes/${scene.slug}`}
      className="group relative min-h-[18rem] overflow-hidden rounded-3xl border border-white/70 bg-white/70 shadow-sm shadow-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-300/60 dark:bg-slate-100/56"
    >
      <Image
        src={imageSrc}
        alt={`${scene.title} 应用场景`}
        fill
        className="object-cover transition-transform duration-700 group-hover:scale-105"
        sizes="(min-width: 1024px) 50vw, 100vw"
      />
      <div
        data-featured-scene-overlay
        className="absolute inset-x-0 bottom-0 h-[74%]"
      />
      <div className="relative flex min-h-[18rem] flex-col justify-between p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="rounded-full border border-white/70 bg-white/82 px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm backdrop-blur-md">
            {scene.eyebrow}
          </span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white shadow-sm backdrop-blur-md transition group-hover:translate-x-0.5">
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{scene.title}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/84 sm:text-base">{scene.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {scene.workflow.slice(0, 3).map((step) => (
              <span key={step.title} className="rounded-full border border-white/20 bg-white/12 px-2.5 py-1 text-xs font-medium text-white/92 backdrop-blur-md">
                {step.title}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

function ToolCard({ tool }: { tool: SceneResource & { sceneTitle: string } }) {
  const external = isExternalHref(tool.href);
  const iconSrc = getToolIconSrc(tool);
  return (
    <Link
      href={tool.href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className="group block min-w-0 rounded-xl border border-slate-200 bg-white/85 p-3 shadow-sm transition hover:border-brand-100 hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-300/70 dark:bg-slate-100/58 dark:hover:border-slate-400/70 dark:hover:bg-slate-50/80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
            {iconSrc ? (
              <img src={iconSrc} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />
            ) : (
              <Wrench className="h-3.5 w-3.5 text-brand-500" />
            )}
          </span>
          <span className="min-w-0 break-words">
            <span className={`block whitespace-normal break-words text-sm font-semibold ${uiSurfaces.titleText}`}>{tool.label}</span>
            <span className={`mt-1 block whitespace-normal break-words text-xs leading-relaxed ${uiSurfaces.mutedText}`}>{tool.description}</span>
          </span>
        </div>
        {external ? (
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition group-hover:text-brand-600" />
        ) : (
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition group-hover:text-brand-600" />
        )}
      </div>
      <p className="mt-2 whitespace-normal break-words text-xs font-medium text-gray-400 dark:text-slate-500">{tool.sceneTitle}</p>
    </Link>
  );
}

function ToolGroupCard({ group }: { group: ToolGroup }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/60 p-3 dark:border-slate-300/70 dark:bg-slate-100/48">
      <h3 className={`mb-3 text-sm font-semibold ${uiSurfaces.titleText}`}>{group.title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {group.items.map((tool) => (
          <ToolCard key={`${tool.label}-${tool.href}`} tool={tool} />
        ))}
      </div>
    </div>
  );
}

export default function ScenesIndexPage() {
  const tools = getUniqueTools();
  const toolColumns = balanceToolColumns(groupToolsForLayout(tools));
  const featuredScenes = featuredSceneSlugs.map(sceneBySlug).filter((scene): scene is SceneDefinition => Boolean(scene));

  return (
    <div className={`min-h-screen ${uiSurfaces.servicePage}`}>
      <AdaptiveHeaderWithProductSearch showNav />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 lg:pb-12">
        <section className="mb-6 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
          <div className={`rounded-3xl p-4 sm:p-5 ${uiSurfaces.panelStrong}`}>
            <div className={`mb-3 inline-flex items-center gap-2 ${uiSurfaces.chip}`}>
              <Compass className="h-4 w-4" />
              应用与场景
            </div>
            <h1 className={`max-w-2xl text-xl font-semibold tracking-tight sm:text-3xl ${uiSurfaces.titleText}`}>
              按实验类型查找资料和工具
            </h1>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {actionCards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link
                    key={card.title}
                    href={card.href}
                    className="group flex min-h-12 items-center gap-2.5 rounded-2xl border border-white/72 bg-white/62 px-3 py-2 transition hover:border-brand-100 hover:bg-white/82 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-300/70 dark:bg-slate-100/54"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className={`min-w-0 text-sm font-semibold ${uiSurfaces.titleText}`}>{card.title}</p>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className={`grid gap-2 rounded-3xl p-3 sm:p-4 ${uiSurfaces.panel}`}>
            {quickLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-white/72 bg-white/70 px-3 py-2 transition hover:border-brand-100 hover:bg-white/86 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-300/70 dark:bg-slate-100/58"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-50 text-brand-600">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className={`block text-sm font-semibold ${uiSurfaces.titleText}`}>{item.label}</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mb-8">
          <HomeSectionHeader title="常用实验场景" className="mb-5 sm:mb-5" />
          <div className="grid gap-4 lg:grid-cols-2">
            {featuredScenes.map((scene) => (
              <FeaturedSceneCard key={scene.slug} scene={scene} />
            ))}
          </div>
        </section>

        <section id="scene-map" className="scroll-mt-site-header">
          <HomeSectionHeader title="全部实验类型" className="mb-5 sm:mb-5" />

          <div className="space-y-6">
            {sceneGroups.map((group) => {
              const groupScenes = group.slugs.map(sceneBySlug).filter((scene): scene is SceneDefinition => Boolean(scene));
              return (
                <section key={group.title} className={`rounded-3xl p-4 ${uiSurfaces.panel}`}>
                  <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className={`text-lg font-semibold ${uiSurfaces.titleText}`}>{group.title}</h3>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {groupScenes.map((scene) => (
                      <SceneCard key={scene.slug} scene={scene} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        <section id="public-tools" className={`mt-8 scroll-mt-site-header rounded-3xl p-4 sm:p-5 ${uiSurfaces.panel}`}>
          <HomeSectionHeader title="公共工具与分析软件" className="mb-5 sm:mb-5" />

          <div className="grid items-start gap-3 lg:grid-cols-2">
            {toolColumns.map((column, columnIndex) => (
              <div key={columnIndex} className="grid items-start gap-3">
                {column.map((group) => (
                  <ToolGroupCard key={group.title} group={group} />
                ))}
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
