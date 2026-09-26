import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b04.generated.json';

export type B04Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B04Method = { method_id: string; display_order: number; category: string; title: string; principle: string; answers: string; sample_design: string; limitations: string; source_ids: string[] } & ResearchDeepDiveMethodExtras;
export type B04Reference = { source_id: string; title: string; authors: string; journal: string; published_date: string; doi: string; pmid: string; url: string; source_type: string; study_context: string; study_design: string; usable_for: string; limitations: string };
export type B04Topic = { topic_id: string; title: string; topic_role: string; overview: string; sections: B04Section[]; methods: B04Method[]; shared_findings?: ResearchDeepDiveSharedFinding[]; references: B04Reference[] };

export const b04Snapshot = snapshot as { schema_version: string; batch_id: 'B04'; title: string; publication_status: 'snapshot_ready'; frontend_status: string; topics: B04Topic[] };

export const b04TopicRoutes = [
  { topicId: 'H034', slug: 'microbiome-metabolites-host-interactions', shortLabel: '微生物组代谢物与宿主互作' },
  { topicId: 'H035', slug: 'metabolic-inflammation-chronic-disease', shortLabel: '代谢性炎症与慢性疾病' },
  { topicId: 'H036', slug: 'obesity-fatty-liver-cardiometabolic-multiomics', shortLabel: '肥胖、脂肪肝与心代谢多组学' },
] as const;

export function getB04TopicBySlug(slug: string) {
  const route = b04TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b04Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
