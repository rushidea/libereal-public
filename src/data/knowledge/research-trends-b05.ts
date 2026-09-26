import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b05.generated.json';

export type B05Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B05Method = { method_id: string; display_order: number; category: string; title: string; principle: string; answers: string; sample_design: string; limitations: string; source_ids: string[] } & ResearchDeepDiveMethodExtras;
export type B05Reference = { source_id: string; title: string; authors: string; journal: string; published_date: string; doi: string; pmid: string; url: string; source_type: string; study_context: string; study_design: string; usable_for: string; limitations: string };
export type B05Topic = { topic_id: string; title: string; topic_role: string; overview: string; sections: B05Section[]; methods: B05Method[]; shared_findings?: ResearchDeepDiveSharedFinding[]; references: B05Reference[] };

export const b05Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B05';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  topics: B05Topic[];
};

export const b05TopicRoutes = [
  { topicId: 'H023', slug: 'engineered-immune-cell-therapies', shortLabel: 'CAR-T、TCR-T 与工程化免疫细胞' },
  { topicId: 'H024', slug: 'immune-checkpoints-combination-immunomodulation', shortLabel: '免疫检查点与组合免疫调控' },
  { topicId: 'H027', slug: 'molecular-stratification-functional-oncology', shortLabel: '分子分层与功能精准肿瘤学' },
  { topicId: 'H037', slug: 'liquid-biopsy-circulating-biomarkers', shortLabel: '液体活检与循环分子标志物' },
] as const;

export function getB05TopicBySlug(slug: string) {
  const route = b05TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b05Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
