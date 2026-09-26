import { describe, expect, it } from 'vitest';
import { b01Snapshot, b01TopicRoutes, getB01TopicBySlug } from '@/data/knowledge/research-trends-b01';
import { researchTrendTopics } from '@/data/research-trends-navigation';

describe('B01 public research snapshots', () => {
  it('contains two frontend-ready topics with complete public evidence fields', () => {
    expect(b01Snapshot.batch_id).toBe('B01');
    expect(b01Snapshot.publication_status).toBe('snapshot_ready');
    expect(b01Snapshot.topics).toHaveLength(2);
    expect(b01Snapshot.topics.map((topic) => topic.topic_id)).toEqual(['H025', 'H026']);
    for (const topic of b01Snapshot.topics) {
      expect(topic.sections).toHaveLength(8);
      expect(topic.methods).toHaveLength(5);
      expect(topic.methods.every((method) => Boolean(method.workflow && method.quality_control && method.result_interpretation))).toBe(true);
      expect(topic.shared_findings).toHaveLength(5);
      expect(topic.references).toHaveLength(20);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
      expect(topic.overview).toMatch(/出发/);
      expect(topic.overview).toMatch(/回答|处理三类研究问题|由此可以回答/);
    }
  });

  it('resolves every B01 route to its snapshot topic', () => {
    expect(new Set(b01TopicRoutes.map((route) => route.slug)).size).toBe(2);
    for (const route of b01TopicRoutes) {
      const result = getB01TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(researchTrendTopics.find((topic) => topic.id === route.topicId)).toMatchObject({
        slug: route.slug,
        status: 'published',
      });
    }
    expect(getB01TopicBySlug('unknown-topic')).toBeNull();
  });
});
