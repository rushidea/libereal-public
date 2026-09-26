import { describe, expect, it } from 'vitest';
import { b02Snapshot, b02TopicRoutes, getB02TopicBySlug } from '@/data/knowledge/research-trends-b02';

describe('B02 public research snapshot', () => {
  it('publishes four complete deep-dive topics', () => {
    expect(b02Snapshot.schema_version).toBe('research-deep-dive-public-v0.1');
    expect(b02Snapshot.publication_status).toBe('snapshot_ready');
    expect(b02Snapshot.topics).toHaveLength(4);
    expect(b02Snapshot.topics.every((topic) => topic.sections.length > 0)).toBe(true);
    expect(b02Snapshot.topics.every((topic) => topic.methods.length > 0)).toBe(true);
    expect(b02Snapshot.topics.every((topic) => topic.references.length >= 20)).toBe(true);
  });

  it('maps every public route to one approved topic', () => {
    expect(new Set(b02TopicRoutes.map((route) => route.slug)).size).toBe(4);
    for (const route of b02TopicRoutes) {
      expect(getB02TopicBySlug(route.slug)?.topic.topic_id).toBe(route.topicId);
    }
    expect(getB02TopicBySlug('unknown-topic')).toBeNull();
  });

  it('does not expose internal workflow or commerce fields', () => {
    const serialized = JSON.stringify(b02Snapshot);
    for (const field of ['review_status', 'review_notes', 'model', 'prompt', 'product_id', 'catalog_number', 'price']) {
      expect(serialized).not.toContain(`\"${field}\"`);
    }
  });
});
