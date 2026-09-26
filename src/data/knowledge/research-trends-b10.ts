import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b10.generated.json';
import { laterTopicTimelines, type ResearchProgressTimelineItem } from './research-trends-later-timelines';

export type B10Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B10Method = { method_id: string; display_order: number; category: string; title: string; principle: string; answers: string; sample_design: string; limitations: string; source_ids: string[] } & ResearchDeepDiveMethodExtras;
export type B10Reference = { source_id: string; title: string; authors: string; journal: string; published_date: string; doi: string; pmid: string; url: string; source_type: string; study_context: string; study_design: string; usable_for: string; limitations: string };
export type B10Topic = { topic_id: string; title: string; topic_role: string; overview: string; sections: B10Section[]; methods: B10Method[]; timeline?: ResearchProgressTimelineItem[]; shared_findings?: ResearchDeepDiveSharedFinding[]; references: B10Reference[] };

const rawB10Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B10';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  topics: B10Topic[];
};

export const b10Snapshot = {
  ...rawB10Snapshot,
  topics: rawB10Snapshot.topics.map((topic) => ({ ...topic, timeline: laterTopicTimelines[topic.topic_id] ?? topic.timeline })),
};

export const b10TopicRoutes = [
  { topicId: 'H030', slug: 'neural-interfaces-recording-neuromodulation', shortLabel: '神经接口、高密度记录与神经调控' },
  { topicId: 'H038', slug: 'multiplex-ultrasensitive-molecular-diagnostics', shortLabel: '多重与超灵敏分子诊断' },
  { topicId: 'H043', slug: 'decentralized-clinical-trials-digital-endpoints', shortLabel: '去中心化临床研究与数字终点' },
  { topicId: 'H044', slug: 'real-world-evidence-target-trial-emulation', shortLabel: '真实世界证据与目标试验模拟' },
  { topicId: 'H045', slug: 'federated-clinical-data-precision-cohorts', shortLabel: '联邦临床数据、精准队列与实施科学' },
] as const;

export function getB10TopicBySlug(slug: string) {
  const route = b10TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b10Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
