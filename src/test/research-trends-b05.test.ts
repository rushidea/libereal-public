import { describe, expect, it } from 'vitest';
import { b05Snapshot, b05TopicRoutes, getB05TopicBySlug } from '@/data/knowledge/research-trends-b05';
import { researchTrendTopics } from '@/data/research-trends-navigation';

describe('B05 public research snapshots', () => {
  it('contains four frontend-ready topics with complete public evidence fields', () => {
    expect(b05Snapshot.batch_id).toBe('B05');
    expect(b05Snapshot.publication_status).toBe('snapshot_ready');
    expect(b05Snapshot.topics).toHaveLength(4);
    expect(b05Snapshot.topics.map((topic) => topic.topic_id)).toEqual(['H023', 'H024', 'H027', 'H037']);
    for (const topic of b05Snapshot.topics) {
      expect(topic.sections).toHaveLength(8);
      expect(topic.methods).toHaveLength(5);
      expect(topic.methods.every((method) => Boolean(method.workflow && method.quality_control && method.result_interpretation))).toBe(true);
      expect(topic.shared_findings).toHaveLength(5);
      expect(topic.references).toHaveLength(20);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
    }
  });

  it('resolves every B05 route to its snapshot topic', () => {
    expect(new Set(b05TopicRoutes.map((route) => route.slug)).size).toBe(4);
    for (const route of b05TopicRoutes) {
      const result = getB05TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(researchTrendTopics.find((topic) => topic.id === route.topicId)).toMatchObject({
        slug: route.slug,
        status: 'published',
      });
    }
    expect(getB05TopicBySlug('unknown-topic')).toBeNull();
  });
});
