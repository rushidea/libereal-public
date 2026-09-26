import { describe, expect, it } from 'vitest';
import type { DiscoveryItem } from '@/data/discoveries';
import {
  inferDiscoveryArticleType,
  mapPubMedSummary,
  parseDiscoveryRss,
  sortDiscoveries,
} from '@/lib/discoveries';

describe('parseDiscoveryRss', () => {
  it('extracts journal metadata and omits corrections', () => {
    const xml = `
      <rdf:RDF>
        <item rdf:about="https://example.com/a">
          <title><![CDATA[Macrophage signaling in inflammation]]></title>
          <link>https://example.com/a</link>
          <dc:creator>Author One</dc:creator>
          <dc:creator>Author Two</dc:creator>
          <dc:date>2026-07-17</dc:date>
          <prism:doi>10.1000/example</prism:doi>
          <prism:volume>18</prism:volume>
          <prism:number>4</prism:number>
        </item>
        <item rdf:about="https://example.com/correction">
          <title>Author Correction: Previous article</title>
          <link>https://example.com/correction</link>
          <dc:date>2026-07-18</dc:date>
        </item>
      </rdf:RDF>`;

    const items = parseDiscoveryRss(xml, 'cmi');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      journalId: 'cmi',
      doi: '10.1000/example',
      authors: ['Author One', 'Author Two'],
      publishedAt: '2026-07-17',
      volume: '18',
      issue: '4',
    });
  });
});

describe('mapPubMedSummary', () => {
  it('maps PubMed metadata to a CJNM discovery', () => {
    const item = mapPubMedSummary({
      uid: '12345',
      title: 'Natural product discovery.',
      sortpubdate: '2026/07/01 00:00',
      authors: [{ name: 'Wang N' }, { name: 'Sun C' }],
      pubtype: ['Journal Article'],
      articleids: [{ idtype: 'doi', value: '10.1016/example' }],
      volume: '24',
      issue: '7',
      pages: '1-9',
    });

    expect(item).toMatchObject({
      id: 'cjnm-12345',
      title: 'Natural product discovery',
      doi: '10.1016/example',
      authors: ['Wang N', 'Sun C'],
      publishedAt: '2026-07-01',
    });
  });
});

describe('discovery ordering and labels', () => {
  it('orders newest records first', () => {
    const base = {
      journalId: 'jbr',
      journal: 'JBR',
      institution: '南京医科大学',
      city: '南京',
      title: 'Article',
      authors: [],
      articleType: '研究论文',
      url: 'https://example.com',
    } satisfies Omit<DiscoveryItem, 'id' | 'publishedAt'>;
    const sorted = sortDiscoveries([
      { ...base, id: 'old', publishedAt: '2026-01-01' },
      { ...base, id: 'new', publishedAt: '2026-07-01' },
    ]);
    expect(sorted.map(item => item.id)).toEqual(['new', 'old']);
  });

  it('recognizes review and commentary titles', () => {
    expect(inferDiscoveryArticleType('A systematic review')).toBe('综述');
    expect(inferDiscoveryArticleType('Editorial commentary')).toBe('评论');
    expect(inferDiscoveryArticleType('Experimental study')).toBe('研究论文');
  });
});
