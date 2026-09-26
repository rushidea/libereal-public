import snapshot from './research-trends.generated.json';
import { researchTrendHrefById } from '@/data/research-trends-navigation';

export type ResearchTrendHotspot = {
  id: string;
  categoryId: string;
  nameZh: string;
  nameEn: string;
  summary: string;
  trendSignal: string;
};

export type ResearchTrendCategory = {
  id: string;
  nameZh: string;
  nameEn: string;
  definition: string;
  inScope: string[];
  outOfScope: string[];
  hotspotCount: number;
};

export type ResearchTrendsSnapshot = {
  releaseId: string;
  asOfDate: string;
  researchWindow: string;
  categoryCount: number;
  hotspotCount: number;
  deferredCount: number;
  registeredSourceCount: number;
  categories: ResearchTrendCategory[];
  hotspots: ResearchTrendHotspot[];
};

export const researchTrendsSnapshot = snapshot as ResearchTrendsSnapshot;

export const researchTrendDeepDiveHrefById = researchTrendHrefById;

const featuredHotspotIds = ['H006', 'H008', 'H020', 'H022', 'H037', 'H041'];

export const featuredResearchTrends = featuredHotspotIds
  .map((id) => researchTrendsSnapshot.hotspots.find((hotspot) => hotspot.id === id))
  .filter((hotspot): hotspot is ResearchTrendHotspot => Boolean(hotspot));
