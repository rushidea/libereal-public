import { describe, expect, it } from 'vitest';
import {
  getResearchDeepDiveTopicBySlug,
  hasDedicatedResearchTrendRoute,
} from '@/data/knowledge/research-trends-deep-dive';
import { tumorSpatialImmunitySnapshot } from '@/data/knowledge/tumor-spatial-immunity';
import { researchTrendTopics } from '@/data/research-trends-navigation';

function paragraphs(text: string) {
  return text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

describe('research trend overview content', () => {
  it('keeps every published topic on the same three-part overview standard', () => {
    const publishedTopics = researchTrendTopics.filter((topic) => topic.status === 'published');
    const unresolved = publishedTopics.flatMap((topic) => {
      if (hasDedicatedResearchTrendRoute(topic.slug)) return [];
      const result = getResearchDeepDiveTopicBySlug(topic.slug);
      if (!result || result.topic.topic_id !== topic.id) return [{ id: topic.id, reason: 'missing dataset' }];
      const overview = paragraphs(result.topic.overview);
      return overview.length === 3 && overview.every((paragraph) => paragraph.length >= 70)
        ? []
        : [{ id: topic.id, reason: `overview paragraphs=${overview.length}` }];
    });

    expect(publishedTopics).toHaveLength(43);
    expect(unresolved).toEqual([]);
  });

  it('keeps the dedicated H022 page on the same three-part overview standard', () => {
    const overview = paragraphs(tumorSpatialImmunitySnapshot.summary);

    expect(overview).toHaveLength(3);
    expect(overview.every((paragraph) => paragraph.length >= 70)).toBe(true);
  });
});
