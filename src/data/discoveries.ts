import { researchTrendNavigation } from './research-trends-navigation';

export type DiscoveryJournalId = 'jbr' | 'cmi' | 'cjnm';

export type DiscoveryItem = {
  id: string;
  journalId: DiscoveryJournalId;
  journal: string;
  institution: string;
  city: '南京' | '合肥';
  title: string;
  titleEn?: string;
  summary?: string;
  authors: string[];
  articleType: string;
  publishedAt: string;
  doi?: string;
  url: string;
  volume?: string;
  issue?: string;
  pages?: string;
};

export type DiscoveryCacheData = {
  discoveries: DiscoveryItem[];
  updatedAt: string;
  sources: Record<DiscoveryJournalId, { fetched: number; available: boolean }>;
};

export const DISCOVERY_JOURNALS = [
  {
    id: 'jbr',
    shortName: 'JBR',
    name: 'Journal of Biomedical Research',
    institution: '南京医科大学',
    city: '南京',
  },
  {
    id: 'cmi',
    shortName: 'CMI',
    name: 'Cellular & Molecular Immunology',
    institution: '中国科学技术大学、中国免疫学会',
    city: '合肥',
  },
  {
    id: 'cjnm',
    shortName: 'CJNM',
    name: 'Chinese Journal of Natural Medicines',
    institution: '中国药科大学、中国药学会',
    city: '南京',
  },
] as const satisfies ReadonlyArray<{
  id: DiscoveryJournalId;
  shortName: string;
  name: string;
  institution: string;
  city: '南京' | '合肥';
}>;

export const DISCOVERY_PAGE_SIZE = 24;

export const discoveriesNavOverview = {
  href: '/discoveries',
  label: '发现首页',
} as const;

export const discoveriesNavItems = [
  {
    id: 'articles',
    href: '/discoveries',
    label: '服务号文章',
  },
  {
    id: 'journals',
    href: '/discoveries?tab=journals',
    label: '期刊论文',
  },
  {
    id: 'trends',
    label: '研究热点',
    groups: researchTrendNavigation,
  },
] as const;
