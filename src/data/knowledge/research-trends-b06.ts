import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b06.generated.json';

export type B06Section = { section_id: string; title: string; body: string; source_ids: string[] };
export type B06Method = {
  method_id: string;
  display_order: number;
  category: string;
  title: string;
  principle: string;
  answers: string;
  sample_design: string;
  limitations: string;
  source_ids: string[];
} & ResearchDeepDiveMethodExtras;
export type B06Reference = {
  source_id: string;
  title: string;
  authors: string;
  journal: string;
  published_date: string;
  doi: string;
  pmid: string;
  url: string;
  source_type: string;
  study_context: string;
  study_design: string;
  usable_for: string;
  limitations: string;
};
export type B06Topic = {
  topic_id: string;
  title: string;
  topic_role: string;
  overview: string;
  sections: B06Section[];
  methods: B06Method[];
  shared_findings?: ResearchDeepDiveSharedFinding[];
  references: B06Reference[];
};

export const b06Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B06';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: 'snapshot_ready';
  topics: B06Topic[];
};

export const b06TopicRoutes = [
  { topicId: 'H001', slug: 'biomolecular-structure-interaction-prediction' },
  { topicId: 'H002', slug: 'ai-molecular-design-virtual-screening' },
  { topicId: 'H014', slug: 'cryo-em-in-situ-structural-dynamics' },
  { topicId: 'H015', slug: 'de-novo-protein-biomolecule-design' },
  { topicId: 'H040', slug: 'phenotypic-screening-target-validation' },
] as const;

export function getB06TopicBySlug(slug: string) {
  const route = b06TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b06Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
