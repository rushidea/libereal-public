export type ResearchDeepDiveSharedFinding = {
  finding_id: string;
  display_order: number;
  title: string;
  shared_result: string;
  research_use: string;
  boundary: string;
  source_ids: string[];
};

export type ResearchDeepDiveMethodExtras = {
  workflow?: string;
  quality_control?: string;
  result_interpretation?: string;
};
