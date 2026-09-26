import { describe, expect, it } from 'vitest';
import { b08Snapshot, b08TopicRoutes, getB08TopicBySlug } from '@/data/knowledge/research-trends-b08';

describe('B08 public research snapshots', () => {
  it('contains four frontend-ready topics with complete public evidence fields', () => {
    expect(b08Snapshot.batch_id).toBe('B08');
    expect(b08Snapshot.topics).toHaveLength(4);
    for (const topic of b08Snapshot.topics) {
      expect(topic.sections).toHaveLength(8);
      expect(topic.methods).toHaveLength(5);
      expect(topic.shared_findings).toHaveLength(5);
      expect(topic.references).toHaveLength(20);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
      expect(topic.references.every((reference) => reference.pmid.length > 0)).toBe(true);
    }
  });

  it('resolves every B08 route to its snapshot topic', () => {
    for (const route of b08TopicRoutes) {
      const result = getB08TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(result?.topic.references).toHaveLength(20);
    }
  });

  it('returns null for unknown B08 slugs', () => {
    expect(getB08TopicBySlug('unknown-topic')).toBeNull();
  });
});
