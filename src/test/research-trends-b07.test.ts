import { describe, expect, it } from 'vitest';
import { b07Snapshot, b07TopicRoutes, getB07TopicBySlug } from '@/data/knowledge/research-trends-b07';
import { researchTrendTopics } from '@/data/research-trends-navigation';

describe('B07 public research snapshots', () => {
  it('contains seven frontend-ready topics with complete public evidence fields', () => {
    expect(b07Snapshot.batch_id).toBe('B07');
    expect(b07Snapshot.publication_status).toBe('snapshot_ready');
    expect(b07Snapshot.source_record_count).toBe(156);
    expect(b07Snapshot.unique_publication_count).toBe(148);
    expect(b07Snapshot.topics).toHaveLength(7);
    expect(b07Snapshot.topics.map((topic) => topic.topic_id)).toEqual(['H003', 'H004', 'H008', 'H009', 'H010', 'H011', 'H012']);
    for (const topic of b07Snapshot.topics) {
      expect(topic.sections).toHaveLength(5);
      expect(topic.sections.map((section) => section.title)).toEqual([
        '概述',
        '研究进展',
        '研究工具和方法',
        '应用与疾病关联',
        '参考文献',
      ]);
      expect(topic.methods).toHaveLength(5);
      expect(topic.methods.every((method) => Boolean(method.workflow))).toBe(true);
      expect((topic.shared_findings ?? []).length).toBeGreaterThan(0);
      expect((topic.timeline ?? []).length).toBeGreaterThan(0);
      expect(topic.references.length).toBeGreaterThanOrEqual(22);
      expect(topic.references.every((reference) => reference.url.startsWith('http'))).toBe(true);
    }
  });

  it('resolves every B07 route to its snapshot topic', () => {
    expect(new Set(b07TopicRoutes.map((route) => route.slug)).size).toBe(7);
    for (const route of b07TopicRoutes) {
      const result = getB07TopicBySlug(route.slug);
      expect(result?.topic.topic_id).toBe(route.topicId);
      expect(researchTrendTopics.find((topic) => topic.id === route.topicId)).toMatchObject({
        slug: route.slug,
        status: 'published',
      });
    }
    expect(getB07TopicBySlug('unknown-topic')).toBeNull();
  });

  it('does not expose internal workflow or commerce fields', () => {
    const serialized = JSON.stringify(b07Snapshot);
    for (const field of ['review_status', 'review_notes', 'model', 'prompt', 'product_id', 'catalog_number', 'price']) {
      expect(serialized).not.toContain(`"${field}"`);
    }
  });
});
