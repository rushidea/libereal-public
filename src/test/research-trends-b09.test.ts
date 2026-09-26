import { describe, expect, it } from 'vitest';
import { b09Snapshot, b09TopicRoutes, getB09TopicBySlug } from '@/data/knowledge/research-trends-b09';

describe('B09 public research snapshots', () => {
  it('contains four frontend-ready topics with complete public evidence fields', () => {
    expect(b09Snapshot.batch_id).toBe('B09');
    expect(b09Snapshot.topics).toHaveLength(4);
    for (const topic of b09Snapshot.topics) {
      expect(topic.sections).toHaveLength(8);
      expect(topic.sections[0]?.title).toBe('比较不同研究时应先看什么');
      expect(topic.methods).toHaveLength(5);
      expect(topic.shared_findings).toHaveLength(5);
      expect(topic.references).toHaveLength(20);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
      expect(topic.references.every((reference) => reference.pmid.length > 0)).toBe(true);
    }
  });

  it('resolves every B09 route to its snapshot topic', () => {
    for (const route of b09TopicRoutes) {
      const result = getB09TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(result?.topic.references).toHaveLength(20);
    }
  });

  it('returns null for unknown B09 slugs', () => {
    expect(getB09TopicBySlug('unknown-topic')).toBeNull();
  });
});
