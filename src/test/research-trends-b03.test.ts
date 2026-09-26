import { describe, expect, it } from 'vitest';
import { b03Snapshot, b03TopicRoutes, getB03TopicBySlug } from '@/data/knowledge/research-trends-b03';

describe('B03 public research snapshots', () => {
  it('contains four frontend-ready topics with complete public evidence fields', () => {
    expect(b03Snapshot.batch_id).toBe('B03');
    expect(b03Snapshot.topics).toHaveLength(4);
    for (const topic of b03Snapshot.topics) {
      expect(topic.sections.length).toBeGreaterThan(0);
      expect(topic.methods).toHaveLength(5);
      expect(topic.references).toHaveLength(20);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
    }
  });

  it('resolves every published route to its snapshot topic', () => {
    for (const route of b03TopicRoutes) {
      const result = getB03TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(result?.topic.references).toHaveLength(20);
    }
  });
});
