import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b09.generated.json';
import { laterTopicTimelines, type ResearchProgressTimelineItem } from './research-trends-later-timelines';

export type B09Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B09Method = { method_id: string; display_order: number; category: string; title: string; principle: string; answers: string; sample_design: string; limitations: string; source_ids: string[] } & ResearchDeepDiveMethodExtras;
export type B09Reference = { source_id: string; title: string; authors: string; journal: string; published_date: string; doi: string; pmid: string; url: string; source_type: string; study_context: string; study_design: string; usable_for: string; limitations: string };
export type B09Topic = { topic_id: string; title: string; topic_role: string; overview: string; sections: B09Section[]; methods: B09Method[]; timeline?: ResearchProgressTimelineItem[]; shared_findings?: ResearchDeepDiveSharedFinding[]; references: B09Reference[] };

const rawB09Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B09';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  topics: B09Topic[];
};

export const b09Snapshot = {
  ...rawB09Snapshot,
  topics: rawB09Snapshot.topics.map((topic) => ({ ...topic, timeline: laterTopicTimelines[topic.topic_id] ?? topic.timeline })),
};

export const b09TopicRoutes = [
  { topicId: 'H031', slug: 'pathogen-genomics-surveillance', shortLabel: '病原体基因组与基因组监测' },
  { topicId: 'H032', slug: 'vaccine-platforms-correlates-of-protection', shortLabel: '新型疫苗平台与免疫保护相关物' },
  { topicId: 'H033', slug: 'antimicrobial-resistance-anti-infective-strategies', shortLabel: '抗微生物耐药与新型抗感染策略' },
  { topicId: 'H041', slug: 'rna-lipid-nanoparticle-targeted-delivery', shortLabel: 'RNA、脂质纳米颗粒与靶向递送' },
] as const;

export function getB09TopicBySlug(slug: string) {
  const route = b09TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b09Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
