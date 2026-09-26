import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b02.generated.json';

export type B02Section = {
  section_id: string;
  title: string;
  body: string;
  source_ids: string[];
};

export type B02Method = {
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

export type B02Reference = {
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

export type B02Topic = {
  topic_id: string;
  title: string;
  topic_role: string;
  overview: string;
  sections: B02Section[];
  methods: B02Method[];
  shared_findings?: ResearchDeepDiveSharedFinding[];
  references: B02Reference[];
};

export const b02Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B02';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  topics: B02Topic[];
};

export const b02TopicRoutes = [
  { topicId: 'H005', slug: 'single-cell-regulatory-epigenomics', shortLabel: '单细胞调控基因组与表观基因组' },
  { topicId: 'H006', slug: 'crispr-precision-editing-screening', shortLabel: 'CRISPR 精准编辑与功能筛选' },
  { topicId: 'H007', slug: 'single-cell-transcriptomics-perturbation-screening', shortLabel: '单细胞转录组与扰动筛选' },
  { topicId: 'H016', slug: 'molecular-recording-lineage-tracing', shortLabel: '分子记录、谱系追踪与命运解析' },
] as const;

export function getB02TopicBySlug(slug: string) {
  const route = b02TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b02Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
