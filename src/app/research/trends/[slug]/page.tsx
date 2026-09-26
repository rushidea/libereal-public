import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import ResearchDeepDiveToc, { type DeepDiveTocItem } from '@/components/research/ResearchDeepDiveToc';
import type { B01Reference } from '@/data/knowledge/research-trends-b01';
import type { B02Reference } from '@/data/knowledge/research-trends-b02';
import type { B03Reference } from '@/data/knowledge/research-trends-b03';
import type { B04Reference } from '@/data/knowledge/research-trends-b04';
import type { B05Reference } from '@/data/knowledge/research-trends-b05';
import type { B06Reference } from '@/data/knowledge/research-trends-b06';
import type { B07Reference } from '@/data/knowledge/research-trends-b07';
import type { B08Reference } from '@/data/knowledge/research-trends-b08';
import type { B09Reference } from '@/data/knowledge/research-trends-b09';
import type { B10Reference } from '@/data/knowledge/research-trends-b10';
import {
  getResearchDeepDiveTopicBySlug,
  hasDedicatedResearchTrendRoute,
} from '@/data/knowledge/research-trends-deep-dive';
import type { ResearchDeepDiveSharedFinding } from '@/data/knowledge/research-deep-dive-public';
import { researchTrendTopicBySlug, researchTrendTopics } from '@/data/research-trends-navigation';
import { scenes, type SceneResource } from '@/data/scenes';
import { uiSurfaces } from '@/lib/ui-surfaces';

export const dynamicParams = false;

export function generateStaticParams() {
  return researchTrendTopics
    .filter((topic) => !hasDedicatedResearchTrendRoute(topic.slug))
    .map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = getResearchDeepDiveTopicBySlug(slug);
  if (!result) {
    const topic = researchTrendTopicBySlug.get(slug);
    if (!topic) return {};
    return {
      title: `${topic.label}研究热点`,
      description: `${topic.label}专题已纳入 Libereal 2020–2026 生命科学与医学研究热点知识体系。`,
      robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: { index: false, follow: false, noimageindex: true },
      },
      other: { bingbot: 'noindex, nofollow, noarchive' },
    };
  }
  return {
    title: `${result.topic.title}研究热点`,
    description: result.topic.overview.split('\n')[0],
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    },
    other: { bingbot: 'noindex, nofollow, noarchive' },
  };
}

function BodyContent({ text }: { text: string }) {
  return text.split(/\n\s*\n/).filter(Boolean).map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const isTable = lines.length >= 2 && lines.every((line) => line.startsWith('|'));
    if (isTable) {
      const rows = lines
        .filter((line) => !/^\|(?:\s*:?-+:?\s*\|)+$/.test(line))
        .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
      const [header, ...body] = rows;
      return (
        <div key={`table-${index}`} className="mt-5 overflow-x-auto rounded-[var(--brand-border-radius)] border border-[var(--brand-color-border)]">
          <table className="min-w-full text-left text-sm leading-7">
            <thead className="bg-[var(--brand-color-primary-bg)] text-[var(--brand-color-text)]">
              <tr>{header?.map((cell) => <th key={cell} className="border-b border-[var(--brand-color-border)] px-4 py-3 font-semibold">{cell}</th>)}</tr>
            </thead>
            <tbody>{body.map((row, rowIndex) => <tr key={`${rowIndex}-${row[0]}`} className="border-b last:border-b-0 border-[var(--brand-color-border)] text-[var(--brand-color-text-secondary)]">{row.map((cell) => <td key={cell} className="px-4 py-3 align-top">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    return <p key={`${index}-${block}`} className="mt-4 text-base leading-8 text-[var(--brand-color-text-secondary)] first:mt-0">{block}</p>;
  });
}

function SourceLinks({
  sourceIds,
  referenceById,
  referenceNumber,
}: {
  sourceIds: string[];
  referenceById: Map<string, B01Reference | B02Reference | B03Reference | B04Reference | B05Reference | B06Reference | B07Reference | B08Reference | B09Reference | B10Reference>;
  referenceNumber: Map<string, number>;
}) {
  const references = sourceIds.flatMap((sourceId) => {
    const reference = referenceById.get(sourceId);
    return reference ? [reference] : [];
  });
  if (references.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5" aria-label="支持该段内容的论文">
      {references.map((reference) => (
        <a
          key={reference.source_id}
          href={reference.url}
          target="_blank"
          rel="noreferrer"
          title={reference.title}
          className="font-mono text-[11px] font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-2"
        >
          [{referenceNumber.get(reference.source_id)}]
        </a>
      ))}
    </span>
  );
}

function SectionMarker({ number, label }: { number: string; label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-base font-semibold leading-6 text-[var(--brand-color-text)] sm:text-lg">
      <span className="font-mono text-sm font-medium text-[var(--brand-color-text-interactive)]">{number}</span>
      <span className="text-[var(--brand-color-text-quaternary)]" aria-hidden="true">·</span>
      <span>{label}</span>
    </p>
  );
}

const publicToolLabelsByTopic: Readonly<Record<string, readonly string[]>> = {
  H001: ['RCSB Protein Data Bank', 'AlphaFold Protein Structure Database', 'ColabFold'],
  H002: ['ChEMBL', 'PubChem', 'DeepChem', 'AutoDock Vina', 'RDKit'],
  H014: ['Electron Microscopy Data Bank', 'EMPIAR', 'RELION'],
  H015: ['ProteinMPNN', 'RFdiffusion'],
  H040: ['CellProfiler', 'Scanpy', 'CHOPCHOP'],
};

type RelatedPublicTool = Pick<SceneResource, 'label' | 'href' | 'description'>;

const topicHeroArtwork: Readonly<Record<string, { webp: string; avif: string; alt: string }>> = {
  H001: { webp: '/images/research/trends/h001-structure-interaction.webp', avif: '/images/research/trends/h001-structure-interaction.avif', alt: '' },
  H002: { webp: '/images/research/trends/h002-ai-molecular-design.webp', avif: '/images/research/trends/h002-ai-molecular-design.avif', alt: '' },
  H005: { webp: '/images/research/trends/b02-single-cell-perturbation.webp', avif: '/images/research/trends/b02-single-cell-perturbation.avif', alt: '' },
  H006: { webp: '/images/research/trends/b02-single-cell-perturbation.webp', avif: '/images/research/trends/b02-single-cell-perturbation.avif', alt: '' },
  H007: { webp: '/images/research/trends/b02-single-cell-perturbation.webp', avif: '/images/research/trends/b02-single-cell-perturbation.avif', alt: '' },
  H014: { webp: '/images/research/trends/h014-cryo-em.webp', avif: '/images/research/trends/h014-cryo-em.avif', alt: '' },
  H015: { webp: '/images/research/trends/h015-de-novo-design.webp', avif: '/images/research/trends/h015-de-novo-design.avif', alt: '' },
  H016: { webp: '/images/research/trends/b02-single-cell-perturbation.webp', avif: '/images/research/trends/b02-single-cell-perturbation.avif', alt: '' },
  H017: { webp: '/images/research/trends/b08-aging-neural-atlas.webp', avif: '/images/research/trends/b08-aging-neural-atlas.avif', alt: '' },
  H018: { webp: '/images/research/trends/b08-aging-neural-atlas.webp', avif: '/images/research/trends/b08-aging-neural-atlas.avif', alt: '' },
  H019: { webp: '/images/research/trends/b03-organoid-organ-chip.webp', avif: '/images/research/trends/b03-organoid-organ-chip.avif', alt: '' },
  H020: { webp: '/images/research/trends/b03-organoid-organ-chip.webp', avif: '/images/research/trends/b03-organoid-organ-chip.avif', alt: '' },
  H021: { webp: '/images/research/trends/b03-organoid-organ-chip.webp', avif: '/images/research/trends/b03-organoid-organ-chip.avif', alt: '' },
  H023: { webp: '/images/research/trends/b05-tumor-immune-therapy.webp', avif: '/images/research/trends/b05-tumor-immune-therapy.avif', alt: '' },
  H024: { webp: '/images/research/trends/b05-tumor-immune-therapy.webp', avif: '/images/research/trends/b05-tumor-immune-therapy.avif', alt: '' },
  H025: { webp: '/images/research/trends/b01-tumor-ecosystem.webp', avif: '/images/research/trends/b01-tumor-ecosystem.avif', alt: '' },
  H026: { webp: '/images/research/trends/b01-tumor-ecosystem.webp', avif: '/images/research/trends/b01-tumor-ecosystem.avif', alt: '' },
  H027: { webp: '/images/research/trends/b05-tumor-immune-therapy.webp', avif: '/images/research/trends/b05-tumor-immune-therapy.avif', alt: '' },
  H028: { webp: '/images/research/trends/b08-aging-neural-atlas.webp', avif: '/images/research/trends/b08-aging-neural-atlas.avif', alt: '' },
  H029: { webp: '/images/research/trends/b08-aging-neural-atlas.webp', avif: '/images/research/trends/b08-aging-neural-atlas.avif', alt: '' },
  H030: { webp: '/images/research/trends/b10-neurodiagnostic-clinical-data.webp', avif: '/images/research/trends/b10-neurodiagnostic-clinical-data.avif', alt: '' },
  H031: { webp: '/images/research/trends/b09-pathogen-vaccine-delivery.webp', avif: '/images/research/trends/b09-pathogen-vaccine-delivery.avif', alt: '' },
  H032: { webp: '/images/research/trends/b09-pathogen-vaccine-delivery.webp', avif: '/images/research/trends/b09-pathogen-vaccine-delivery.avif', alt: '' },
  H033: { webp: '/images/research/trends/b09-pathogen-vaccine-delivery.webp', avif: '/images/research/trends/b09-pathogen-vaccine-delivery.avif', alt: '' },
  H034: { webp: '/images/research/trends/b04-microbiome-metabolism.webp', avif: '/images/research/trends/b04-microbiome-metabolism.avif', alt: '' },
  H035: { webp: '/images/research/trends/b04-microbiome-metabolism.webp', avif: '/images/research/trends/b04-microbiome-metabolism.avif', alt: '' },
  H036: { webp: '/images/research/trends/b04-microbiome-metabolism.webp', avif: '/images/research/trends/b04-microbiome-metabolism.avif', alt: '' },
  H037: { webp: '/images/research/trends/b05-tumor-immune-therapy.webp', avif: '/images/research/trends/b05-tumor-immune-therapy.avif', alt: '' },
  H038: { webp: '/images/research/trends/b10-neurodiagnostic-clinical-data.webp', avif: '/images/research/trends/b10-neurodiagnostic-clinical-data.avif', alt: '' },
  H041: { webp: '/images/research/trends/b09-pathogen-vaccine-delivery.webp', avif: '/images/research/trends/b09-pathogen-vaccine-delivery.avif', alt: '' },
  H042: { webp: '/images/research/trends/b03-organoid-organ-chip.webp', avif: '/images/research/trends/b03-organoid-organ-chip.avif', alt: '' },
  H043: { webp: '/images/research/trends/b10-neurodiagnostic-clinical-data.webp', avif: '/images/research/trends/b10-neurodiagnostic-clinical-data.avif', alt: '' },
  H044: { webp: '/images/research/trends/b10-neurodiagnostic-clinical-data.webp', avif: '/images/research/trends/b10-neurodiagnostic-clinical-data.avif', alt: '' },
  H045: { webp: '/images/research/trends/b10-neurodiagnostic-clinical-data.webp', avif: '/images/research/trends/b10-neurodiagnostic-clinical-data.avif', alt: '' },
  H040: { webp: '/images/research/trends/h040-phenotypic-screening.webp', avif: '/images/research/trends/h040-phenotypic-screening.avif', alt: '' },
  H003: { webp: '/images/research/trends/h003-ai-phenotyping.webp', avif: '/images/research/trends/h003-ai-phenotyping.avif', alt: '' },
  H004: { webp: '/images/research/trends/h004-long-read-pangenome.webp', avif: '/images/research/trends/h004-long-read-pangenome.avif', alt: '' },
  H008: { webp: '/images/research/trends/h008-spatial-multiomics.webp', avif: '/images/research/trends/h008-spatial-multiomics.avif', alt: '' },
  H009: { webp: '/images/research/trends/h009-single-cell-multimodal.webp', avif: '/images/research/trends/h009-single-cell-multimodal.avif', alt: '' },
  H010: { webp: '/images/research/trends/b07-multiomics-networks.webp', avif: '/images/research/trends/b07-multiomics-networks.avif', alt: '' },
  H011: { webp: '/images/research/trends/b07-multiomics-networks.webp', avif: '/images/research/trends/b07-multiomics-networks.avif', alt: '' },
  H012: { webp: '/images/research/trends/b07-multiomics-networks.webp', avif: '/images/research/trends/b07-multiomics-networks.avif', alt: '' },
};

function getRelatedPublicTools(topicId: string): RelatedPublicTool[] {
  const labels = publicToolLabelsByTopic[topicId] ?? [];
  const toolsByLabel = new Map<string, RelatedPublicTool>();
  for (const scene of scenes) {
    for (const tool of scene.analysisSoftware ?? []) {
      if (!toolsByLabel.has(tool.label)) {
        toolsByLabel.set(tool.label, tool);
      }
    }
  }
  return labels.flatMap((label) => {
    const tool = toolsByLabel.get(label);
    return tool ? [tool] : [];
  });
}

function SharedFindingsList({
  findings,
  referenceById,
  referenceNumber,
}: {
  findings: ResearchDeepDiveSharedFinding[];
  referenceById: Map<string, B01Reference | B02Reference | B03Reference | B04Reference | B05Reference | B06Reference | B07Reference | B08Reference | B09Reference | B10Reference>;
  referenceNumber: Map<string, number>;
}) {
  return (
    <div className="mt-9 divide-y divide-[var(--brand-color-border)] border-y border-[var(--brand-color-border)]">
      {findings.map((finding) => (
        <article key={finding.finding_id} className="py-6 sm:py-7">
          <h3 className="text-base font-semibold leading-7 text-[var(--brand-color-text)]">{finding.title}</h3>
          <p className="mt-4 text-base leading-8 text-[var(--brand-color-text-secondary)]">{finding.shared_result}</p>
          <p className="mt-4 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{finding.research_use}</p>
          <p className="mt-4 border-l-2 border-[var(--brand-color-warning)] pl-5 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{finding.boundary}</p>
          <div className="mt-5">
            <SourceLinks sourceIds={finding.source_ids} referenceById={referenceById} referenceNumber={referenceNumber} />
          </div>
        </article>
      ))}
    </div>
  );
}

type ResearchTrendTopicRoute = (typeof researchTrendTopics)[number];

function ResearchTopicSkeletonPage({ topic }: { topic: ResearchTrendTopicRoute }) {
  const relatedTopics = researchTrendTopics.filter(
    (item) => item.sectionId === topic.sectionId && item.id !== topic.id,
  );

  return (
    <div className={`${uiSurfaces.page} min-h-screen pb-16 lg:pb-0`}>
      <AdaptiveHeader showNav />
      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <header className="border-b border-[var(--brand-color-border)] pb-10 sm:pb-14">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span className={uiSurfaces.badge}>专题建设中</span>
            <span className="font-mono uppercase tracking-[0.12em] text-[var(--brand-color-text-quaternary)]">{topic.id} · 2020–2026</span>
          </div>
          <p className="mt-6 text-sm font-semibold text-[var(--brand-color-text-interactive)]">
            {topic.groupLabel} <span className="px-1.5 text-[var(--brand-color-text-quaternary)]">/</span> {topic.sectionLabel}
          </p>
          <h1 className="mt-4 max-w-4xl font-serif text-3xl leading-[1.2] tracking-[-0.03em] text-[var(--brand-color-text)] sm:text-4xl">
            {topic.label}
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-8 text-[var(--brand-color-text-secondary)]">
            该专题已纳入 Libereal 生命科学与医学研究热点知识体系。研究简报、证据地图和代表性文献完成审核后，将在此发布完整内容。
          </p>
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm">
            <Link href="/research/trends" className="font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4">返回研究热点</Link>
          </div>
        </header>

        <section className="py-10 sm:py-14">
          <p className="text-sm font-semibold text-[var(--brand-color-text)]">同一方向的专题</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {relatedTopics.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`rounded-[var(--brand-border-radius)] border border-[var(--brand-color-border)] px-4 py-4 transition-colors hover:bg-[var(--brand-color-primary-bg)] ${uiSurfaces.focusRing}`}
              >
                <span className="font-mono text-[11px] text-[var(--brand-color-text-quaternary)]">{item.id}</span>
                <span className="mt-1 block text-sm font-semibold leading-6 text-[var(--brand-color-text)]">{item.label}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}

export default async function ResearchTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = getResearchDeepDiveTopicBySlug(slug);
  if (!result) {
    const topic = researchTrendTopicBySlug.get(slug);
    if (!topic) notFound();
    return <ResearchTopicSkeletonPage topic={topic} />;
  }
  const { topic } = result;
  const heroArtwork = topicHeroArtwork[topic.topic_id];
  const isH014Sample = topic.topic_id === 'H014';
  const hasChronologicalTimeline = 'timeline' in topic && Array.isArray(topic.timeline) && topic.timeline.length > 0;
  const contentSections = topic.sections.filter((section) => !['概述', '研究进展', '研究技术', '研究工具和方法', '应用与疾病关联', '参考文献', '科研参考范围'].includes(section.title));
  const progressSection = topic.sections.find((section) => section.title === '研究进展');
  const applicationSection = topic.sections.find((section) => section.title === '应用与疾病关联');
  const timeline = hasChronologicalTimeline && 'timeline' in topic ? topic.timeline ?? [] : [];
  const h014ProgressSections = isH014Sample ? contentSections.slice(0, 4) : [];
  const h014ApplicationSections = isH014Sample ? contentSections.slice(4) : [];
  const scopeSection = topic.sections.find((section) => section.title === '科研参考范围');
  const referenceById = new Map(topic.references.map((reference) => [reference.source_id, reference]));
  const referenceNumber = new Map(topic.references.map((reference, index) => [reference.source_id, index + 1]));
  const relatedPublicTools = getRelatedPublicTools(topic.topic_id);
  const sharedFindings = 'shared_findings' in topic && Array.isArray(topic.shared_findings)
    ? [...topic.shared_findings].sort((left, right) => left.display_order - right.display_order)
    : [];
  const showStandaloneSharedFindings = sharedFindings.length > 0 && !isH014Sample && !hasChronologicalTimeline;
  const methodsNumber = isH014Sample || hasChronologicalTimeline
    ? '03'
    : String(contentSections.length + (showStandaloneSharedFindings ? 2 : 1)).padStart(2, '0');
  const publicToolsNumber = String(contentSections.length + (showStandaloneSharedFindings ? 3 : 2)).padStart(2, '0');
  const referencesNumber = isH014Sample || hasChronologicalTimeline
    ? '05'
    : String(contentSections.length + (relatedPublicTools.length > 0 ? 3 : 2) + (showStandaloneSharedFindings ? 1 : 0)).padStart(2, '0');
  const tocItems: DeepDiveTocItem[] = isH014Sample || hasChronologicalTimeline
    ? [
        { id: 'overview', number: '01', label: '概述' },
        { id: 'research-progress', number: '02', label: '研究进展' },
        { id: 'research-methods', number: '03', label: '研究工具和方法' },
        { id: 'applications', number: '04', label: '应用与疾病关联' },
        { id: 'references', number: '05', label: '参考文献' },
      ]
    : [
        ...contentSections.map((section, index) => ({ id: section.section_id, number: String(index + 1).padStart(2, '0'), label: section.title })),
        ...(showStandaloneSharedFindings
          ? [{ id: 'shared-findings', number: String(contentSections.length + 1).padStart(2, '0'), label: '共同认识' }]
          : []),
        { id: 'research-methods', number: methodsNumber, label: '研究技术' },
        ...(relatedPublicTools.length > 0 ? [{ id: 'public-tools', number: publicToolsNumber, label: '相关公共工具' }] : []),
        { id: 'references', number: referencesNumber, label: '参考文献' },
      ];

  return (
    <div className={`${uiSurfaces.page} ${heroArtwork ? 'research-topic-illustrated' : ''} min-h-screen pb-16 lg:pb-0`}>
      <AdaptiveHeader showNav />
      <main id={isH014Sample ? 'page-top' : undefined} className="mx-auto w-full max-w-7xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <header id={isH014Sample ? 'overview' : 'page-top'} className="relative isolate flex min-h-[23rem] flex-col scroll-mt-40 overflow-hidden border-b border-[var(--brand-color-border)] pb-10 sm:min-h-[25rem] sm:pb-14">
          <div className="relative z-10 sm:max-w-[48%]">
          {isH014Sample ? (
            <nav aria-label="面包屑导航" className="mb-8 flex items-center gap-2 overflow-hidden text-xs text-[var(--brand-color-text-quaternary)]">
              <Link href="/" className="shrink-0 font-medium hover:text-[var(--brand-color-text)]">首页</Link>
              <span aria-hidden="true">/</span>
              <Link href="/academic-support" className="shrink-0 font-medium hover:text-[var(--brand-color-text)]">学术支持</Link>
              <span aria-hidden="true">/</span>
              <Link href="/research/trends" className="shrink-0 font-medium hover:text-[var(--brand-color-text)]">研究热点</Link>
              <span aria-hidden="true">/</span>
              <span className="truncate text-[var(--brand-color-text-secondary)]" aria-current="page">{topic.topic_id}</span>
            </nav>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span className={uiSurfaces.badgeSuccess}>公开测试版</span>
            <span className="font-mono uppercase tracking-[0.12em] text-[var(--brand-color-text-quaternary)]">{topic.topic_id} · 2020–2026</span>
          </div>
          <h1 className="mt-6 max-w-4xl font-serif text-3xl leading-[1.15] tracking-[-0.03em] text-[var(--brand-color-text)] sm:text-4xl">{topic.title}</h1>
          <div className="mt-6 max-w-4xl"><BodyContent text={topic.overview} /></div>
          {!isH014Sample ? (
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <Link href="/research/trends" className="font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4">返回研究热点</Link>
              <span className="text-xs text-[var(--brand-color-text-quaternary)]">{result.batchId} · {result.batchTitle}</span>
            </div>
          ) : null}
          </div>
          {heroArtwork ? (
            <picture aria-hidden="true" className={`research-topic-hero-art pointer-events-none relative z-0 mt-8 block h-48 w-full shrink-0 select-none sm:absolute sm:inset-0 sm:mt-0 sm:h-auto sm:w-auto ${isH014Sample ? 'research-topic-hero-art--integrated research-topic-hero-art--overview-background' : 'sm:left-[52%] sm:w-[48%]'}`}>
              <source srcSet={heroArtwork.avif} type="image/avif" />
              <source srcSet={heroArtwork.webp} type="image/webp" />
              <img
                src={heroArtwork.webp}
                alt={heroArtwork.alt}
                className="research-topic-hero-image h-full w-full object-cover object-[72%_center] sm:object-[right_center]"
              />
            </picture>
          ) : null}
        </header>

        {isH014Sample ? (
          <nav aria-label="专题栏目" className="hidden border-b border-[var(--brand-color-border)] lg:block">
            <ol className="grid grid-cols-5">
              {tocItems.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="group flex items-center justify-center gap-3 border-b-2 border-transparent px-4 py-6 text-sm font-semibold text-[var(--brand-color-text-secondary)] transition-colors hover:border-[var(--brand-color-primary)] hover:text-[var(--brand-color-text)]">
                    <span className="font-mono text-[10px] font-medium text-[var(--brand-color-text-quaternary)] group-hover:text-[var(--brand-color-text-interactive)]">{item.number}</span>
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12 xl:gap-16">
          <ResearchDeepDiveToc items={tocItems} />
          <div className="min-w-0">
            {isH014Sample ? (
              <section id="research-progress" className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
                <div className="max-w-3xl">
                  <SectionMarker number="02" label="研究进展" />
                  <h2 className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)] sm:text-3xl">从离体颗粒走向原位观察与动态研究</h2>
                  <p className="mt-5 text-base leading-8 text-[var(--brand-color-text-secondary)]">以下内容分别说明单颗粒重建、原位断层成像、时间分辨研究和制样条件能够回答什么，以及解释结果时需要保留哪些限制。</p>
                </div>
                <div className="mt-9 divide-y divide-[var(--brand-color-border)] border-y border-[var(--brand-color-border)]">
                  {h014ProgressSections.map((section, index) => (
                    <details key={section.section_id} className="group" open={index === 0}>
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 marker:hidden sm:py-7">
                        <div className="grid gap-3 sm:grid-cols-[3rem_1fr] sm:items-start sm:gap-5">
                          <span className="font-mono text-xs text-[var(--brand-color-text-interactive)]">{String(index + 1).padStart(2, '0')}</span>
                          <h3 className="text-base font-semibold leading-7 text-[var(--brand-color-text)]">{section.title}</h3>
                        </div>
                        <span className="shrink-0 text-xl leading-7 text-[var(--brand-color-text-quaternary)]" aria-hidden="true"><span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span></span>
                      </summary>
                      <div className="pb-8 sm:pl-16">
                        <div className="max-w-3xl"><BodyContent text={section.body} /></div>
                        <div className="mt-5"><SourceLinks sourceIds={section.source_ids} referenceById={referenceById} referenceNumber={referenceNumber} /></div>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ) : hasChronologicalTimeline ? (
              <section id="research-progress" className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
                <div className="max-w-3xl">
                  <SectionMarker number="02" label="研究进展" />
                  <div className="mt-7 divide-y divide-[var(--brand-color-border)] border-y border-[var(--brand-color-border)]">
                    {timeline.map((item) => (
                      <article key={item.display_order} className="grid gap-3 py-6 sm:grid-cols-[5rem_1fr] sm:gap-6 sm:py-7">
                        <p className="font-mono text-sm font-semibold text-[var(--brand-color-text-interactive)]">{item.year}</p>
                        <div><BodyContent text={item.discovery} /><div className="mt-4"><SourceLinks sourceIds={item.source_ids} referenceById={referenceById} referenceNumber={referenceNumber} /></div></div>
                      </article>
                    ))}
                  </div>
                  {sharedFindings.length > 0 ? (
                    <div className="mt-12">
                      <h3 className="font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">多项研究共同支持的认识</h3>
                      <SharedFindingsList findings={sharedFindings} referenceById={referenceById} referenceNumber={referenceNumber} />
                    </div>
                  ) : null}
                </div>
              </section>
            ) : (
              <>
                {contentSections.map((section, index) => (
                  <section key={section.section_id} id={section.section_id} className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
                    <div className="max-w-3xl">
                      <SectionMarker number={String(index + 1).padStart(2, '0')} label={section.title} />
                      <div className="mt-6"><BodyContent text={section.body} /></div>
                      <div className="mt-5">
                        <SourceLinks sourceIds={section.source_ids} referenceById={referenceById} referenceNumber={referenceNumber} />
                      </div>
                    </div>
                  </section>
                ))}
                {showStandaloneSharedFindings ? (
                  <section id="shared-findings" className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
                    <div className="max-w-3xl">
                      <SectionMarker number={String(contentSections.length + 1).padStart(2, '0')} label="共同认识" />
                      <h2 className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">多项研究共同支持什么</h2>
                      <SharedFindingsList findings={sharedFindings} referenceById={referenceById} referenceNumber={referenceNumber} />
                    </div>
                  </section>
                ) : null}
              </>
            )}

            <section id="research-methods" className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
              <div className="max-w-3xl">
                <SectionMarker number={methodsNumber} label={isH014Sample || hasChronologicalTimeline ? '研究工具和方法' : '研究技术'} />
                <h2 className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">各类技术分别测量什么</h2>
                <p className="mt-5 text-base leading-8 text-[var(--brand-color-text-secondary)]">展开技术卡，可查看测量原理、适用问题、样本设计和结果解释范围。</p>
              </div>
              <div className="mt-9 divide-y divide-[var(--brand-color-border)] border-y border-[var(--brand-color-border)]">
                {topic.methods.map((method) => (
                  <details key={method.method_id} className="group">
                    <summary className="cursor-pointer list-none py-6 marker:hidden sm:py-7">
                      <div className="grid gap-3 sm:grid-cols-[3rem_14rem_1fr] sm:items-start sm:gap-5">
                        <span className="font-mono text-xs text-[var(--brand-color-text-interactive)]">{String(method.display_order).padStart(2, '0')}</span>
                        <div>
                          <p className="text-xs font-semibold text-[var(--brand-color-text-interactive)]">{method.category}</p>
                          <h3 className="mt-2 text-base font-semibold leading-6 text-[var(--brand-color-text)]">{method.title}</h3>
                        </div>
                        <div className="flex items-start justify-between gap-5">
                          <p className="text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.answers}</p>
                          <span className="shrink-0 text-xl text-[var(--brand-color-text-quaternary)]" aria-hidden="true"><span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span></span>
                        </div>
                      </div>
                    </summary>
                    <div className="grid gap-5 pb-8 sm:grid-cols-[3rem_14rem_1fr] sm:gap-5">
                      <span aria-hidden="true" />
                      <div><p className="mb-2 text-xs text-[var(--brand-color-text-quaternary)]">代表性研究</p><SourceLinks sourceIds={method.source_ids} referenceById={referenceById} referenceNumber={referenceNumber} /></div>
                      <dl className="space-y-5">
                        <div><dt className="text-sm font-semibold text-[var(--brand-color-text)]">测量原理</dt><dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.principle}</dd></div>
                        <div className="border-t border-[var(--brand-color-border)] pt-5"><dt className="text-sm font-semibold text-[var(--brand-color-text)]">适合回答的问题</dt><dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.answers}</dd></div>
                        <div className="border-t border-[var(--brand-color-border)] pt-5"><dt className="text-sm font-semibold text-[var(--brand-color-text)]">样本与实验设计</dt><dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.sample_design}</dd></div>
                        {method.workflow ? <div className="border-t border-[var(--brand-color-border)] pt-5"><dt className="text-sm font-semibold text-[var(--brand-color-text)]">实验与分析流程</dt><dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.workflow}</dd></div> : null}
                        {method.quality_control ? <div className="border-t border-[var(--brand-color-border)] pt-5"><dt className="text-sm font-semibold text-[var(--brand-color-text)]">质控与独立确认</dt><dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.quality_control}</dd></div> : null}
                        {method.result_interpretation ? <div className="border-t border-[var(--brand-color-border)] pt-5"><dt className="text-sm font-semibold text-[var(--brand-color-text)]">结果能解释到哪一步</dt><dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.result_interpretation}</dd></div> : null}
                        <div className="border-l-2 border-[var(--brand-color-warning)] pl-5"><dt className="text-sm font-semibold text-[var(--brand-color-text)]">解释结果时需要注意</dt><dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.limitations}</dd></div>
                      </dl>
                    </div>
                  </details>
                ))}
              </div>
              {isH014Sample && relatedPublicTools.length > 0 ? (
                <div className="mt-12 border-t border-[var(--brand-color-border)] pt-9">
                  <div className="max-w-3xl">
                    <p className="text-sm font-semibold text-[var(--brand-color-text)]">相关公共数据与分析工具</p>
                    <p className="mt-3 text-sm leading-7 text-[var(--brand-color-text-secondary)]">用于检索公开电镜数据、复用原始图像或开展重建分析；不能替代样本制备、直接测量和独立验证。</p>
                  </div>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {relatedPublicTools.map((tool) => (
                      <li key={`${tool.label}-${tool.href}`}>
                        <a href={tool.href} target="_blank" rel="noreferrer" className={`block h-full rounded-[var(--brand-border-radius)] border border-[var(--brand-color-border)] p-5 transition-colors hover:bg-[var(--brand-color-primary-bg)] ${uiSurfaces.focusRing}`}>
                          <span className="text-sm font-semibold text-[var(--brand-color-text)]">{tool.label} <span className="text-[var(--brand-color-text-quaternary)]" aria-hidden="true">↗</span></span>
                          <span className="mt-2 block text-sm leading-7 text-[var(--brand-color-text-secondary)]">{tool.description}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {isH014Sample ? (
              <section id="applications" className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
                <div className="max-w-3xl">
                  <SectionMarker number="04" label="应用与疾病关联" />
                  <h2 className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)] sm:text-3xl">结构结果如何进入机制与疾病研究</h2>
                  <p className="mt-5 text-base leading-8 text-[var(--brand-color-text-secondary)]">结构图像可以为机制研究提供线索，但是否与疾病过程有关，仍需结合计量、突变、结合、功能读出或患者样本等独立证据。本页只说明这一步所需的证据条件，不从结构图像直接推导疾病机制或治疗结论。</p>
                </div>
                <div className="mt-9 max-w-3xl space-y-8">
                  {h014ApplicationSections.map((section) => (
                    <article key={section.section_id} className="border-l-2 border-[var(--brand-color-primary)] pl-5 sm:pl-7">
                      <h3 className="text-base font-semibold leading-7 text-[var(--brand-color-text)]">{section.title}</h3>
                      <div className="mt-4"><BodyContent text={section.body} /></div>
                      <div className="mt-5"><SourceLinks sourceIds={section.source_ids} referenceById={referenceById} referenceNumber={referenceNumber} /></div>
                    </article>
                  ))}
                </div>
              </section>
            ) : hasChronologicalTimeline ? (
              <section id="applications" className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
                <div className="max-w-3xl">
                  <SectionMarker number="04" label="应用与疾病关联" />
                  <div className="mt-7 divide-y divide-[var(--brand-color-border)] border-y border-[var(--brand-color-border)]">
                    {timeline.map((item) => (
                      <article key={item.display_order} className="grid gap-3 py-6 sm:grid-cols-[5rem_1fr] sm:gap-6 sm:py-7">
                        <p className="font-mono text-sm font-semibold text-[var(--brand-color-text-interactive)]">{item.year}</p>
                        <div><BodyContent text={item.application} /><div className="mt-4"><SourceLinks sourceIds={item.source_ids} referenceById={referenceById} referenceNumber={referenceNumber} /></div></div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {!isH014Sample && relatedPublicTools.length > 0 && (
              <section id="public-tools" className="scroll-mt-32 border-b border-[var(--brand-color-border)] py-12 sm:py-16">
                <div className="max-w-3xl">
                  <SectionMarker number={publicToolsNumber} label="相关公共工具" />
                  <h2 className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">用于查找资料与提出研究假设</h2>
                  <p className="mt-5 text-base leading-8 text-[var(--brand-color-text-secondary)]">这些公共资源可用于查找数据、整理候选或处理研究资料。它们不替代本页所列的实验验证，也不构成产品、实验方案或临床建议。</p>
                </div>
                <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                  {relatedPublicTools.map((tool) => (
                    <li key={`${tool.label}-${tool.href}`}>
                      <a href={tool.href} target="_blank" rel="noreferrer" className={`block h-full rounded-[var(--brand-border-radius)] border border-[var(--brand-color-border)] p-5 transition-colors hover:bg-[var(--brand-color-primary-bg)] ${uiSurfaces.focusRing}`}>
                        <span className="text-sm font-semibold text-[var(--brand-color-text)]">{tool.label} <span className="text-[var(--brand-color-text-quaternary)]" aria-hidden="true">↗</span></span>
                        <span className="mt-2 block text-sm leading-7 text-[var(--brand-color-text-secondary)]">{tool.description}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section id="references" className="scroll-mt-32 py-12 sm:py-16">
              <div className="max-w-3xl">
                <SectionMarker number={referencesNumber} label="参考文献" />
                <h2 className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">代表性论文与综述</h2>
                <p className="mt-5 text-sm leading-7 text-[var(--brand-color-text-secondary)]">本页各项表述所依据的公开研究资料。展开后可查看论文信息、研究对象和适用范围。</p>
              </div>
              <details className="group mt-9 border-y border-[var(--brand-color-border)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 marker:hidden"><span className="text-sm font-semibold text-[var(--brand-color-text)]">展开查看 {topic.references.length} 篇参考文献</span><span className="text-xl text-[var(--brand-color-text-quaternary)]" aria-hidden="true"><span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span></span></summary>
                <ol className="divide-y divide-[var(--brand-color-border)] border-t border-[var(--brand-color-border)]">
                  {topic.references.map((reference, index) => (
                    <li key={reference.source_id} className="py-6">
                      <div className="grid gap-3 sm:grid-cols-[3rem_1fr]">
                        <span className="font-mono text-xs text-[var(--brand-color-text-quaternary)]">[{index + 1}]</span>
                        <div>
                          <p className="text-sm font-semibold leading-6 text-[var(--brand-color-text)]">{reference.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--brand-color-text-secondary)]">{reference.authors} · {reference.journal} · {reference.published_date}</p>
                          <p className="mt-2 text-xs leading-6 text-[var(--brand-color-text-quaternary)]">{reference.study_context}；{reference.study_design}</p>
                          <a href={reference.url} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-xs text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4">{reference.doi ? `DOI ${reference.doi}` : reference.pmid ? `PMID ${reference.pmid}` : '查看原文'}</a>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </section>

            <aside className={`${uiSurfaces.panel} bg-[var(--brand-color-bg-layout)] p-5 text-sm leading-7 text-[var(--brand-color-text-secondary)] sm:p-6`}>
              {scopeSection?.body ?? '本页整理公开发表的研究和综述，供科研人员了解方向进展；不提供诊疗建议或治疗推荐。'}
              <p className="mt-3 text-sm leading-7 text-[var(--brand-color-text-quaternary)]">如有建议或发现错误，欢迎来函至：support@libereal.cn</p>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
