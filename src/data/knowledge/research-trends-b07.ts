import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b07.generated.json';
import { laterTopicTimelines } from './research-trends-later-timelines';

export type B07Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B07Method = { method_id: string; display_order: number; category: string; title: string; principle: string; answers: string; sample_design: string; limitations: string; source_ids: string[] } & ResearchDeepDiveMethodExtras;
export type B07Reference = { source_id: string; title: string; journal: string; published_date: string; doi: string; pmid: string; url: string; source_type: string; evidence_role: string; authors?: string; study_context?: string; study_design?: string; usable_for?: string; limitations?: string };
export type B07TimelineItem = { display_order: number; year: number; discovery: string; application: string; source_ids: string[] };
export type B07Topic = { topic_id: string; title: string; topic_role: string; overview: string; sections: B07Section[]; methods: B07Method[]; timeline?: B07TimelineItem[]; shared_findings?: ResearchDeepDiveSharedFinding[]; references: B07Reference[] };

const rawB07Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B07';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  snapshot_date: string;
  source_record_count: number;
  unique_publication_count: number;
  topics: B07Topic[];
};

export const b07Snapshot = {
  ...rawB07Snapshot,
  topics: rawB07Snapshot.topics.map((topic) => ({ ...topic, timeline: laterTopicTimelines[topic.topic_id] ?? topic.timeline })),
};

export const b07TopicRoutes = [
  { topicId: 'H003', slug: 'ai-phenotyping-experimental-decision-support', shortLabel: 'AI 表型分析与实验决策支持' },
  { topicId: 'H004', slug: 'long-read-pangenome-complex-variants', shortLabel: '长读长、人类泛基因组与复杂变异' },
  { topicId: 'H008', slug: 'spatial-transcriptomics-multiomics', shortLabel: '空间转录组与空间多组学' },
  { topicId: 'H009', slug: 'single-cell-multimodal-in-situ-measurement', shortLabel: '单细胞多模态与原位测量' },
  { topicId: 'H010', slug: 'multiomics-network-biology', shortLabel: '多组学整合与网络生物学' },
  { topicId: 'H011', slug: 'longitudinal-omics-dynamic-systems', shortLabel: '纵向组学与动态系统建模' },
  { topicId: 'H012', slug: 'biomedical-knowledge-graphs-data-standards', shortLabel: '生物医学知识图谱、数据标准与可复现性' },
] as const;

export function getB07TopicBySlug(slug: string) {
  const route = b07TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b07Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
