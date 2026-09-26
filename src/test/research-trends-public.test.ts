import { describe, expect, it } from 'vitest';
import {
  featuredResearchTrends,
  researchTrendDeepDiveHrefById,
  researchTrendsSnapshot,
} from '@/data/knowledge/research-trends';
import { findForbiddenKnowledgeFields } from '@/lib/knowledge-staging';

describe('public research trends snapshot', () => {
  it('publishes the approved taxonomy without deferred candidates', () => {
    expect(researchTrendsSnapshot.categoryCount).toBe(15);
    expect(researchTrendsSnapshot.hotspotCount).toBe(43);
    expect(researchTrendsSnapshot.deferredCount).toBe(2);
    expect(researchTrendsSnapshot.categories).toHaveLength(15);
    expect(researchTrendsSnapshot.hotspots).toHaveLength(43);
    expect(researchTrendsSnapshot.hotspots.map((hotspot) => hotspot.id)).not.toContain('H013');
    expect(researchTrendsSnapshot.hotspots.map((hotspot) => hotspot.id)).not.toContain('H039');
  });

  it('keeps category relationships and public identifiers internally consistent', () => {
    const categoryIds = new Set(researchTrendsSnapshot.categories.map((category) => category.id));
    const hotspotIds = researchTrendsSnapshot.hotspots.map((hotspot) => hotspot.id);

    expect(new Set(hotspotIds).size).toBe(hotspotIds.length);
    expect(researchTrendsSnapshot.categories.reduce((sum, category) => sum + category.hotspotCount, 0)).toBe(43);
    for (const hotspot of researchTrendsSnapshot.hotspots) {
      expect(categoryIds.has(hotspot.categoryId)).toBe(true);
    }
  });

  it('does not leak product, transaction or source-link fields into the public snapshot', () => {
    expect(findForbiddenKnowledgeFields(researchTrendsSnapshot)).toEqual([]);
    expect(JSON.stringify(researchTrendsSnapshot)).not.toMatch(/productId|catalogNumber|price|stockQuantity|source_ids/i);
    expect(JSON.stringify(researchTrendsSnapshot)).not.toMatch(/scoreAverage|momentum|evidenceQuality/i);
  });

  it('provides a stable six-topic homepage selection', () => {
    expect(featuredResearchTrends).toHaveLength(6);
    expect(new Set(featuredResearchTrends.map((hotspot) => hotspot.id)).size).toBe(6);
    expect(featuredResearchTrends.map((hotspot) => hotspot.id)).toContain('H022');
    expect(researchTrendDeepDiveHrefById.H022).toBe('/research/trends/tumor-spatial-immunity');
  });
});
