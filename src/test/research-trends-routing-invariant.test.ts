import { describe, expect, it } from 'vitest';
import {
  dedicatedResearchTrendSlugs,
  getResearchDeepDiveTopicBySlug,
  hasDedicatedResearchTrendRoute,
} from '@/data/knowledge/research-trends-deep-dive';
import { researchTrendTopics } from '@/data/research-trends-navigation';

describe('research trend route invariant', () => {
  it('gives every published topic a deep-dive dataset or a dedicated route', () => {
    const publishedTopics = researchTrendTopics.filter((topic) => topic.status === 'published');
    const unresolvedTopics = publishedTopics.flatMap((topic) => {
      if (hasDedicatedResearchTrendRoute(topic.slug)) return [];
      const result = getResearchDeepDiveTopicBySlug(topic.slug);
      return result?.topic.topic_id === topic.id
        ? []
        : [{ id: topic.id, slug: topic.slug, resolvedTopicId: result?.topic.topic_id ?? null }];
    });

    expect(unresolvedTopics).toEqual([]);
    expect(publishedTopics.filter((topic) => hasDedicatedResearchTrendRoute(topic.slug)).map((topic) => topic.id)).toEqual(['H022']);
  });

  it('keeps H022 on its dedicated route', () => {
    expect(dedicatedResearchTrendSlugs).toEqual(['tumor-spatial-immunity']);
    expect(getResearchDeepDiveTopicBySlug('tumor-spatial-immunity')).toBeNull();
    expect(researchTrendTopics.find((topic) => topic.id === 'H022')).toMatchObject({
      slug: 'tumor-spatial-immunity',
      status: 'published',
    });
  });
});
