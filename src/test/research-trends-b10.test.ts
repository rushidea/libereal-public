import { describe, expect, it } from 'vitest';
import { b10Snapshot, b10TopicRoutes, getB10TopicBySlug } from '@/data/knowledge/research-trends-b10';

describe('B10 public research snapshots', () => {
  it('contains five frontend-ready topics with complete public evidence fields', () => {
    expect(b10Snapshot.batch_id).toBe('B10');
    expect(b10Snapshot.topics).toHaveLength(5);
    for (const topic of b10Snapshot.topics) {
      expect(topic.sections).toHaveLength(8);
      expect(topic.sections[0]?.title).toBe('比较不同研究时应先看什么');
      expect(topic.methods).toHaveLength(5);
      expect(topic.shared_findings).toHaveLength(5);
      expect(topic.references).toHaveLength(20);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
      expect(topic.references.every((reference) => reference.pmid.length > 0)).toBe(true);
    }
  });

  it('resolves every B10 route to its snapshot topic', () => {
    for (const route of b10TopicRoutes) {
      const result = getB10TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(result?.topic.references).toHaveLength(20);
    }
  });

  it('returns null for unknown B10 slugs', () => {
    expect(getB10TopicBySlug('unknown-topic')).toBeNull();
  });
});
