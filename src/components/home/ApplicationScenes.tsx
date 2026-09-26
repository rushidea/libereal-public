'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowRight } from 'lucide-react';
import HomeSectionHeader from '@/components/home/HomeSectionHeader';
import { scenes } from '@/data/scenes';
import { getSceneTheme } from '@/lib/scene-theme';
import { uiSurfaces } from '@/lib/ui-surfaces';

type HomeSceneCard = {
  slug: string;
  title: string;
  summary: string;
  badge: string;
  tags: string[];
};

const BASE_SCENE_SLOT_COUNT = 3;
const WIDE_MOBILE_SCENE_SLOT_COUNT = 4;
const WIDE_MOBILE_MEDIA_QUERY = '(min-width: 740px) and (max-width: 1023px)';

function subscribeToWideMobile(onChange: () => void) {
  const mediaQuery = window.matchMedia(WIDE_MOBILE_MEDIA_QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function getWideMobileSnapshot() {
  return window.matchMedia(WIDE_MOBILE_MEDIA_QUERY).matches;
}

function getWideMobileServerSnapshot() {
  return false;
}

const FEATURED_SCENES: HomeSceneCard[] = [
  {
    slug: 'elisa',
    title: 'ELISA',
    summary: '选试剂盒，做标准曲线，回算样本浓度。',
    badge: '标准曲线 · 结果回算',
    tags: ['检测指标', '标准曲线', '结果复核'],
  },
  {
    slug: 'western-blot',
    title: 'Western Blot',
    summary: '查抗体、配转膜显影试剂，处理条带和背景问题。',
    badge: '抗体选择 · 转膜显影',
    tags: ['样本裂解', '电泳转膜', '信号优化'],
  },
  {
    slug: 'ihc',
    title: 'IHC 免疫组化',
    summary: '看组织切片中的蛋白定位，配置修复、显色和封片材料。',
    badge: '组织定位 · 显色评分',
    tags: ['切片确认', '抗原修复', 'DAB 显色'],
  },
  {
    slug: 'small-animal-imaging',
    title: '小动物实验与成像',
    summary: '围绕动物模型、麻醉监测、活体成像采集和 ROI 定量组织实验材料。',
    badge: '动物模型 · 活体成像',
    tags: ['模型准备', '探针给药', 'ROI 定量'],
  },
  {
    slug: 'immunofluorescence',
    title: '免疫荧光',
    summary: '配一抗、荧光二抗和染色通道，减少串色和背景。',
    badge: '多色通道 · 共定位分析',
    tags: ['固定通透', '通道规划', '成像分析'],
  },
  {
    slug: 'flow-cytometry',
    title: '流式细胞术',
    summary: '准备样本，设计 panel，安排补偿、死活染和上机质控。',
    badge: 'Panel 设计 · 补偿质控',
    tags: ['样本计数', '荧光搭配', 'FMO 对照'],
  },
  {
    slug: 'molecular-biology',
    title: '分子生物学',
    summary: '处理核酸提取、PCR/qPCR、克隆构建和转染材料。',
    badge: 'PCR/qPCR · 引物资源',
    tags: ['核酸提取', '体系设计', '克隆验证'],
  },
  {
    slug: 'magnetic-cell-separation',
    title: '免疫磁珠分选',
    summary: '判断正选、负选和去除法，准备流式或单细胞前样本。',
    badge: '正选负选 · 富集分离',
    tags: ['样本制备', '分选策略', '纯度验证'],
  },
  {
    slug: 'elispot-fluorospot',
    title: 'ELISpot / FluoroSpot',
    summary: '设计孔位和刺激条件，统计分泌反应细胞。',
    badge: '分泌细胞 · Spot 计数',
    tags: ['细胞铺板', '刺激培养', '结果归一'],
  },
  {
    slug: 'single-cell-omics',
    title: '单细胞组学',
    summary: '控制解离质量、细胞活率和碎片比例，准备建库前样本。',
    badge: '样本质控 · 图谱分析',
    tags: ['组织解离', '活率质控', '细胞注释'],
  },
  {
    slug: 'spatial-biology',
    title: '空间生物学',
    summary: '处理组织切片、预染定位、多重标记和图像配准。',
    badge: '组织结构 · 空间表达',
    tags: ['切片质控', 'ROI 标注', '空间分析'],
  },
  {
    slug: 'organoid-3d-culture',
    title: '类器官与 3D 细胞培养',
    summary: '配置 ECM、培养基和生长因子，管理传代、冻存和药筛。',
    badge: '三维模型 · 药筛成像',
    tags: ['ECM 体系', '模型传代', '活力读数'],
  },
  {
    slug: 'crispr-gene-editing',
    title: 'CRISPR 基因编辑',
    summary: '设计 sgRNA，安排递送、筛选、单克隆鉴定和功能验证。',
    badge: 'sgRNA · 功能验证',
    tags: ['靶点设计', '递送筛选', '测序验证'],
  },
  {
    slug: 'extracellular-vesicles',
    title: '细胞外囊泡研究',
    summary: '做 EV 分离富集、粒径浓度检测、marker 表征和污染控制。',
    badge: 'EV 富集 · Marker 验证',
    tags: ['样本前处理', '分离富集', '表征验证'],
  },
  {
    slug: 'proteomics-mass-spec',
    title: '蛋白组学与质谱分析',
    summary: '准备蛋白样本，安排酶解脱盐、数据检索和候选蛋白验证。',
    badge: '样本制备 · 质谱分析',
    tags: ['蛋白提取', '酶解脱盐', '候选验证'],
  },
];

const FEATURED_SCENE_SLUGS = new Set(FEATURED_SCENES.map((scene) => scene.slug));

const ALL_HOME_SCENES: HomeSceneCard[] = [
  ...FEATURED_SCENES,
  ...scenes
    .filter((scene) => !FEATURED_SCENE_SLUGS.has(scene.slug))
    .map((scene) => ({
      slug: scene.slug,
      title: scene.title,
      summary: scene.summary,
      badge: scene.eyebrow,
      tags: scene.overview.slice(0, 3).map((item) => item.title),
    })),
];

const SCENE_CARD_ACCENTS: Record<string, string> = {
  elisa: 'from-emerald-500/90 via-emerald-500/28 to-transparent',
  'western-blot': 'from-indigo-500/90 via-indigo-500/28 to-transparent',
  ihc: 'from-rose-500/90 via-rose-500/28 to-transparent',
  'small-animal-imaging': 'from-sky-500/90 via-sky-500/28 to-transparent',
  immunofluorescence: 'from-purple-500/90 via-purple-500/28 to-transparent',
  'flow-cytometry': 'from-amber-500/90 via-amber-500/28 to-transparent',
  'molecular-biology': 'from-cyan-500/90 via-cyan-500/28 to-transparent',
  'magnetic-cell-separation': 'from-orange-500/90 via-orange-500/28 to-transparent',
  'elispot-fluorospot': 'from-lime-500/90 via-lime-500/28 to-transparent',
  'single-cell-omics': 'from-violet-500/90 via-violet-500/28 to-transparent',
  'spatial-biology': 'from-fuchsia-500/90 via-fuchsia-500/28 to-transparent',
  'organoid-3d-culture': 'from-teal-500/90 via-teal-500/28 to-transparent',
  'crispr-gene-editing': 'from-sky-500/90 via-sky-500/28 to-transparent',
  'extracellular-vesicles': 'from-green-500/90 via-green-500/28 to-transparent',
  'proteomics-mass-spec': 'from-blue-500/90 via-blue-500/28 to-transparent',
};

function getSceneImage(scene: HomeSceneCard) {
  const theme = getSceneTheme(scene.slug);
  return theme.heroIllustration ?? theme.heroImage;
}

function getBadgeClass(scene: HomeSceneCard) {
  if (scene.slug === 'immunofluorescence') {
    return 'border-white/25 bg-white/15 text-white';
  }
  // Night: bg-white* → container (slim bridge); text-gray-950 → brand text (scale map).
  return `border-[var(--surface-border)] bg-[var(--surface-badge)] ${uiSurfaces.titleText}`;
}

/**
 * Slot-based scene card.
 * Each card tracks its own lifecycle via `key` (changes when its scene rotates in).
 * `enter` state plays on mount; `leave` is not needed because rotation unmounts the old scene.
 *
 * Animation strategy: when the rotation engine replaces a slot, this component unmounts
 * and re-mounts with a new scene. We use CSS keyframes to:
 *   1. Fade + slide in from below (200ms ease-out)
 *   2. Slight scale from 0.96 → 1 for a "popping into place" feel
 *   3. The card's content sits at the bottom, so it remains visible as the image scales
 */
function SceneCard({ scene, slotKey }: { scene: HomeSceneCard; slotKey: string }) {
  return (
    <Link
      key={slotKey}
      href={`/scenes/${scene.slug}`}
      className={`group scene-card-enter relative min-h-[14.5rem] overflow-hidden rounded-brand-lg border border-white/70 bg-white/70 shadow-sm shadow-brand-100/50 transition-all hover:-translate-y-0.5 hover:border-white hover:shadow-xl hover:shadow-brand-200/40 ${uiSurfaces.focusRing} sm:min-h-[17rem]`}
    >
      <Image
        src={getSceneImage(scene)}
        alt={`${scene.title} 应用场景`}
        fill
        sizes="(min-width: 1024px) 360px, 100vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <div className={`absolute inset-x-0 bottom-0 h-[68%] bg-gradient-to-t ${SCENE_CARD_ACCENTS[scene.slug] ?? SCENE_CARD_ACCENTS.elisa}`} />
      {/* Fixed dark wash — do not use gray-950 (night scale maps it to light text). */}
      <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="relative flex min-h-[14.5rem] flex-col justify-between p-4 sm:min-h-[17rem] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold shadow-sm backdrop-blur-md ${getBadgeClass(scene)}`}>
            {scene.badge}
          </span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white shadow-sm backdrop-blur-md transition-transform group-hover:translate-x-0.5">
            <ArrowRight size={18} />
          </span>
        </div>

        <div>
          <h3 className="text-xl font-semibold tracking-tight text-white sm:text-3xl">
            {scene.title}
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/88 sm:mt-3 sm:text-base">
            {scene.summary}
          </p>
          <div className="mt-4 hidden flex-wrap gap-2 sm:flex">
            {scene.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/20 bg-white/12 px-2.5 py-1 text-xs font-medium text-white/92 backdrop-blur-md"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function ApplicationScenes() {
  const allScenes = useMemo(() => ALL_HOME_SCENES, []);
  const isWideMobile = useSyncExternalStore(
    subscribeToWideMobile,
    getWideMobileSnapshot,
    getWideMobileServerSnapshot,
  );
  const sceneSlotCount = isWideMobile ? WIDE_MOBILE_SCENE_SLOT_COUNT : BASE_SCENE_SLOT_COUNT;
  const [paused, setPaused] = useState(false);
  // Each slot has an independent scene + a rotation key (counter)
  // The key changes when the scene rotates in, triggering the enter animation
  const [rotation, setRotation] = useState(() => ({
    slots: allScenes.slice(0, WIDE_MOBILE_SCENE_SLOT_COUNT).map((scene) => ({
      scene,
      key: `${scene.slug}-0`,
    })),
    nextSceneIndex: WIDE_MOBILE_SCENE_SLOT_COUNT % allScenes.length,
    replaceSlot: 0,
    tick: 0,
  }));

  useEffect(() => {
    if (paused || allScenes.length <= sceneSlotCount) return;
    const timer = setInterval(() => {
      setRotation((current) => {
        const slots = [...current.slots];
        const tick = current.tick + 1;
        // Desktop and phone begin with three visible scenes; the fourth slot is
        // reserved for the wide-mobile layout and does not affect their order.
        const nextSceneIndex = sceneSlotCount === BASE_SCENE_SLOT_COUNT && current.tick === 0
          ? BASE_SCENE_SLOT_COUNT
          : current.nextSceneIndex;
        slots[current.replaceSlot] = {
          scene: allScenes[nextSceneIndex],
          key: `${allScenes[nextSceneIndex].slug}-${tick}`,
        };

        return {
          slots,
          nextSceneIndex: (nextSceneIndex + 1) % allScenes.length,
          replaceSlot: (current.replaceSlot + 1) % sceneSlotCount,
          tick,
        };
      });
    }, 4200);
    return () => clearInterval(timer);
  }, [allScenes, allScenes.length, paused, sceneSlotCount]);

  return (
    <section id="application-scenes" className="scroll-mt-site-header px-4 py-4 sm:py-8">
      <div className="max-w-6xl mx-auto">
        <HomeSectionHeader title="应用与场景" className="hidden sm:flex" />
        <div
          className="grid gap-4 min-[740px]:grid-cols-2 lg:grid-cols-3"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {rotation.slots.slice(0, sceneSlotCount).map((slot, idx) => (
            <SceneCard
              key={slot.key}
              scene={slot.scene}
              slotKey={`${idx}-${slot.key}`}
            />
          ))}
        </div>
        <div className="mt-3 flex justify-center sm:mt-5">
          <Link
            href="/scenes"
            className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-panel-strong)] px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur transition hover:bg-[var(--surface-hover)] sm:px-4 sm:py-2 sm:text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
          >
            全部场景
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
