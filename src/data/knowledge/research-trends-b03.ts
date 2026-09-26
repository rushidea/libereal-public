import type { ResearchDeepDiveMethodExtras, ResearchDeepDiveSharedFinding } from './research-deep-dive-public';
import snapshot from './research-trends-b03.generated.json';

export type B03Section = {
  section_id: string;
  title: string;
  body: string;
  source_ids: string[];
};

export type B03Method = {
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

export type B03Reference = {
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

export type B03Topic = {
  topic_id: string;
  title: string;
  topic_role: string;
  overview: string;
  sections: B03Section[];
  methods: B03Method[];
  shared_findings?: ResearchDeepDiveSharedFinding[];
  references: B03Reference[];
};

export const b03Snapshot = snapshot as {
  schema_version: string;
  batch_id: 'B03';
  title: string;
  publication_status: 'snapshot_ready';
  frontend_status: string;
  topics: B03Topic[];
};

export const b03TopicRoutes = [
  { topicId: 'H019', slug: 'patient-derived-organoids-disease-models', shortLabel: '患者来源类器官与疾病模型' },
  { topicId: 'H020', slug: 'organ-chips-microphysiological-systems', shortLabel: '器官芯片与微生理系统' },
  { topicId: 'H021', slug: 'scalable-organoid-stem-cell-manufacturing', shortLabel: '类器官与干细胞规模化制造' },
  { topicId: 'H042', slug: 'human-relevant-pkpd-adme-tox-models', shortLabel: '人体相关药代、药效与安全性模型' },
] as const;

export function getB03TopicBySlug(slug: string) {
  const route = b03TopicRoutes.find((item) => item.slug === slug);
  if (!route) return null;
  const topic = b03Snapshot.topics.find((item) => item.topic_id === route.topicId);
  return topic ? { route, topic } : null;
}
