import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b08.generated.json';
import { laterTopicTimelines, type ResearchProgressTimelineItem } from './research-trends-later-timelines';

export type B08Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B08Method = { method_id: string; display_order: number; category: string; title: string; principle: string; answers: string; sample_design: string; limitations: string; source_ids: string[] } & ResearchDeepDiveMethodExtras;
export type B08Reference = { source_id: string; title: string; authors: string; journal: string; published_date: string; doi: string; pmid: string; url: string; source_type: string; study_context: string; study_design: string; usable_for: string; limitations: string };
export type B08Topic = { topic_id: string; title: string; topic_role: string; overview: string; sections: B08Section[]; methods: B08Method[]; timeline?: ResearchProgressTimelineItem[]; shared_findings?: ResearchDeepDiveSharedFinding[]; references: B08Reference[] };

const rawB08Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B08';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  topics: B08Topic[];
};

export const b08Snapshot = {
  ...rawB08Snapshot,
  topics: rawB08Snapshot.topics.map((topic) => ({ ...topic, timeline: laterTopicTimelines[topic.topic_id] ?? topic.timeline })),
};

export const b08TopicRoutes = [
  { topicId: 'H017', slug: 'multi-organ-biological-aging-healthspan', shortLabel: '多器官生物衰老与健康寿命机制' },
  { topicId: 'H018', slug: 'organelle-interactions-ferroptosis', shortLabel: '细胞器互作与铁死亡' },
  { topicId: 'H028', slug: 'brain-cell-cross-scale-atlas', shortLabel: '脑细胞图谱与跨尺度参考图谱' },
  { topicId: 'H029', slug: 'neurodegenerative-cell-atlas-mechanisms', shortLabel: '神经退行性疾病细胞图谱与机制' },
] as const;

export function getB08TopicBySlug(slug: string) {
  const route = b08TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b08Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
