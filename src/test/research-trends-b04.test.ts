import { describe, expect, it } from 'vitest';
import { b04Snapshot, b04TopicRoutes, getB04TopicBySlug } from '@/data/knowledge/research-trends-b04';

describe('B04 public research snapshots', () => {
  it('contains three frontend-ready topics with complete public evidence fields', () => {
    expect(b04Snapshot.batch_id).toBe('B04');
    expect(b04Snapshot.topics).toHaveLength(3);
    for (const topic of b04Snapshot.topics) {
      expect(topic.sections).toHaveLength(8);
      expect(topic.methods).toHaveLength(5);
      expect(topic.references).toHaveLength(20);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
    }
  });

  it('resolves every B04 route to its snapshot topic', () => {
    for (const route of b04TopicRoutes) {
      const result = getB04TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(result?.topic.references).toHaveLength(20);
    }
  });
});
