import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b01.generated.json';
import { laterTopicTimelines, type ResearchProgressTimelineItem } from './research-trends-later-timelines';

export type B01Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B01Method = { method_id: string; display_order: number; category: string; title: string; principle: string; answers: string; sample_design: string; limitations: string; source_ids: string[] } & ResearchDeepDiveMethodExtras;
export type B01Reference = { source_id: string; title: string; authors: string; journal: string; published_date: string; doi: string; pmid: string; url: string; source_type: string; study_context: string; study_design: string; usable_for: string; limitations: string };
export type B01Topic = { topic_id: string; title: string; topic_role: string; overview: string; sections: B01Section[]; methods: B01Method[]; timeline?: ResearchProgressTimelineItem[]; shared_findings?: ResearchDeepDiveSharedFinding[]; references: B01Reference[] };

const rawB01Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B01';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  topics: B01Topic[];
};

export const b01Snapshot = {
  ...rawB01Snapshot,
  topics: rawB01Snapshot.topics.map((topic) => ({ ...topic, timeline: laterTopicTimelines[topic.topic_id] ?? topic.timeline })),
};

export const b01TopicRoutes = [
  { topicId: 'H025', slug: 'tumor-heterogeneity-microenvironment-ecosystems', shortLabel: '肿瘤异质性与微环境生态' },
  { topicId: 'H026', slug: 'clonal-evolution-metastasis-drug-resistance', shortLabel: '克隆演化、转移与耐药' },
] as const;

export function getB01TopicBySlug(slug: string) {
  const route = b01TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b01Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
