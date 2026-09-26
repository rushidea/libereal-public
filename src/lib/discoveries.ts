import type {
  DiscoveryCacheData,
  DiscoveryItem,
  DiscoveryJournalId,
} from '@/data/discoveries';
import { DISCOVERY_JOURNALS } from '@/data/discoveries';
import { translateToChinese } from '@/lib/translator';

const RSS_SOURCES: Record<'jbr' | 'cmi', string> = {
  jbr: 'http://www.jbr-pub.org.cn/rss/current.xml',
  cmi: 'https://www.nature.com/cmi.rss',
};

const PUBMED_SEARCH_URL =
  'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=%22Chinese%20Journal%20of%20Natural%20Medicines%22%5Bjour%5D&retmode=json&retmax=12&sort=pub+date';

const CORRECTION_PATTERN = /^(author\s+)?correction\s*:|^erratum\s*:|^publisher correction\s*:/i;

type PubMedAuthor = { name?: string };
type PubMedArticleId = { idtype?: string; value?: string };
type PubMedSummary = {
  uid?: string;
  title?: string;
  authors?: PubMedAuthor[];
  pubtype?: string[];
  sortpubdate?: string;
  pubdate?: string;
  articleids?: PubMedArticleId[];
  volume?: string;
  issue?: string;
  pages?: string;
};

function journalMeta(id: DiscoveryJournalId) {
  return DISCOVERY_JOURNALS.find(journal => journal.id === id)!;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValues(xml: string, tag: string): string[] {
  const escapedTag = tag.replace(':', '\\:');
  const pattern = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, 'gi');
  return Array.from(xml.matchAll(pattern), match => decodeXml(match[1])).filter(Boolean);
}

function firstTag(xml: string, ...tags: string[]): string {
  for (const tag of tags) {
    const value = tagValues(xml, tag)[0];
    if (value) return value;
  }
  return '';
}

function normalizeDate(value: string): string {
  const exact = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (exact) return exact;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function inferDiscoveryArticleType(title: string, types: string[] = []): string {
  const combined = `${title} ${types.join(' ')}`;
  if (/review|meta-analysis/i.test(combined)) return '综述';
  if (/editorial|commentary|perspective/i.test(combined)) return '评论';
  if (/letter/i.test(combined)) return '短文';
  return '研究论文';
}

export function sortDiscoveries(items: DiscoveryItem[]): DiscoveryItem[] {
  return [...items].sort((left, right) => {
    const dateDiff = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    if (Number.isFinite(dateDiff) && dateDiff !== 0) return dateDiff;
    return left.journalId.localeCompare(right.journalId);
  });
}

export function parseDiscoveryRss(
  xml: string,
  journalId: 'jbr' | 'cmi',
  limit = 12
): DiscoveryItem[] {
  const meta = journalMeta(journalId);
  const rows = Array.from(xml.matchAll(/<item(?:\s+[^>]*)?>([\s\S]*?)<\/item>/gi));
  const discoveries: DiscoveryItem[] = [];

  for (const row of rows) {
    const itemXml = row[1];
    const title = firstTag(itemXml, 'title', 'dc:title');
    if (!title || CORRECTION_PATTERN.test(title)) continue;

    const link = firstTag(itemXml, 'link', 'prism:url');
    const doi = firstTag(itemXml, 'prism:doi', 'dc:identifier').replace(/^doi:\s*/i, '');
    const publishedAt = normalizeDate(firstTag(itemXml, 'dc:date', 'prism:publicationDate', 'pubDate'));
    if (!link || !publishedAt) continue;

    const description = firstTag(itemXml, 'description', 'content:encoded');
    const authors = tagValues(itemXml, 'dc:creator').slice(0, 12);
    const volume = firstTag(itemXml, 'prism:volume') || undefined;
    const issue = firstTag(itemXml, 'prism:number') || undefined;
    const pages = firstTag(itemXml, 'prism:startingPage') || undefined;

    discoveries.push({
      id: `${journalId}-${stableId(doi || link)}`,
      journalId,
      journal: meta.name,
      institution: meta.institution,
      city: meta.city,
      title,
      summary: journalId === 'jbr' && description && description !== title
        ? description.slice(0, 420)
        : undefined,
      authors,
      articleType: inferDiscoveryArticleType(title),
      publishedAt,
      doi: doi || undefined,
      url: doi ? `https://doi.org/${doi}` : link,
      volume,
      issue,
      pages,
    });

    if (discoveries.length >= limit) break;
  }

  return discoveries;
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LIBEREAL discoveries/1.0 (https://libereal.cn)' },
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRssDiscoveries(journalId: 'jbr' | 'cmi'): Promise<DiscoveryItem[]> {
  const response = await fetchWithTimeout(RSS_SOURCES[journalId]);
  if (!response.ok) throw new Error(`${journalId} RSS returned ${response.status}`);
  return parseDiscoveryRss(await response.text(), journalId);
}

function pubMedDate(summary: PubMedSummary): string {
  const sortable = summary.sortpubdate?.slice(0, 10).replaceAll('/', '-');
  if (sortable && /^\d{4}-\d{2}-\d{2}$/.test(sortable)) return sortable;
  const yearMonth = summary.pubdate?.match(/(\d{4})\s+([A-Za-z]{3})/);
  if (!yearMonth) return '';
  const parsed = new Date(`${yearMonth[2]} 1, ${yearMonth[1]}`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

export function mapPubMedSummary(summary: PubMedSummary): DiscoveryItem | null {
  const meta = journalMeta('cjnm');
  const title = decodeXml(summary.title ?? '').replace(/\.$/, '');
  const publishedAt = pubMedDate(summary);
  if (!summary.uid || !title || !publishedAt || CORRECTION_PATTERN.test(title)) return null;
  const doi = summary.articleids?.find(identifier => identifier.idtype === 'doi')?.value;

  return {
    id: `cjnm-${summary.uid}`,
    journalId: 'cjnm',
    journal: meta.name,
    institution: meta.institution,
    city: meta.city,
    title,
    authors: (summary.authors ?? []).map(author => author.name ?? '').filter(Boolean).slice(0, 12),
    articleType: inferDiscoveryArticleType(title, summary.pubtype),
    publishedAt,
    doi,
    url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/`,
    volume: summary.volume || undefined,
    issue: summary.issue || undefined,
    pages: summary.pages || undefined,
  };
}

async function fetchCjnmDiscoveries(): Promise<DiscoveryItem[]> {
  const searchResponse = await fetchWithTimeout(PUBMED_SEARCH_URL);
  if (!searchResponse.ok) throw new Error(`PubMed search returned ${searchResponse.status}`);
  const search = await searchResponse.json() as { esearchresult?: { idlist?: string[] } };
  const ids = search.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryResponse = await fetchWithTimeout(summaryUrl);
  if (!summaryResponse.ok) throw new Error(`PubMed summary returned ${summaryResponse.status}`);
  const payload = await summaryResponse.json() as {
    result?: Record<string, PubMedSummary | string[]> & { uids?: string[] };
  };
  return ids
    .map(id => mapPubMedSummary(payload.result?.[id] as PubMedSummary))
    .filter((item): item is DiscoveryItem => item !== null);
}

async function translateDiscoveryTitles(items: DiscoveryItem[]): Promise<DiscoveryItem[]> {
  if (!process.env.MINIMAX_API_KEY) return items;
  const translated = await Promise.all(items.map(async item => {
    const result = await translateToChinese(item.title, { newsTitle: true });
    if (!result.originalText || result.translatedText === item.title) return item;
    return { ...item, title: result.translatedText, titleEn: item.title };
  }));
  return translated;
}

export async function refreshDiscoveries(): Promise<DiscoveryCacheData> {
  const settled = await Promise.allSettled([
    fetchRssDiscoveries('jbr'),
    fetchRssDiscoveries('cmi'),
    fetchCjnmDiscoveries(),
  ]);
  const ids: DiscoveryJournalId[] = ['jbr', 'cmi', 'cjnm'];
  const sources = {} as DiscoveryCacheData['sources'];
  const collected: DiscoveryItem[] = [];

  settled.forEach((result, index) => {
    const id = ids[index];
    if (result.status === 'fulfilled') {
      collected.push(...result.value);
      sources[id] = { fetched: result.value.length, available: true };
      return;
    }
    console.error(`[Discoveries] ${id} failed:`, result.reason);
    sources[id] = { fetched: 0, available: false };
  });

  const sorted = sortDiscoveries(collected);
  const discoveries = await translateDiscoveryTitles(sorted.slice(0, 30));
  return { discoveries, updatedAt: new Date().toISOString(), sources };
}
