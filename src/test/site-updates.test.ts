import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { siteUpdates } from '@/data/site-updates';
import { siteNavigation } from '@/data/site-navigation';
import { researchTrendTopics } from '@/data/research-trends-navigation';
import { STATIC_SITEMAP_PATHS } from '@/lib/seo/public-urls';

describe('public updates integration', () => {
  it('keeps the updates page discoverable from navigation, footer and sitemap', () => {
    const about = siteNavigation.find((section) => section.id === 'about');
    expect(about?.groups.flatMap((group) => group.links).some((link) => link.href === '/updates')).toBe(true);
    expect(about?.footerLinks.some((link) => link.href === '/updates')).toBe(true);
    expect(STATIC_SITEMAP_PATHS).toContain('/updates');
  });

  it('keeps milestone anchors unique, dates descending and destinations present', () => {
    expect(new Set(siteUpdates.map((entry) => entry.id)).size).toBe(siteUpdates.length);
    const dates = siteUpdates.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort().reverse());
    for (const entry of siteUpdates) {
      expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
      for (const link of entry.links) {
        expect(existsSync(join(process.cwd(), 'src/app', link.href, 'page.tsx'))).toBe(true);
      }
    }
  });

  it('keeps the 43 published research hotspot labels in the two academic-support updates', () => {
    const firstUpdate = siteUpdates.find((entry) => entry.id === 'research-evidence');
    const laterUpdate = siteUpdates.find((entry) => entry.id === 'research-evidence-more');
    const publishedTopics = researchTrendTopics.filter((topic) => topic.status === 'published');

    expect(firstUpdate).toBeDefined();
    expect(laterUpdate).toBeDefined();
    expect(publishedTopics).toHaveLength(43);
    expect(publishedTopics.filter((topic) => firstUpdate?.description.includes(topic.label))).toHaveLength(20);
    expect(publishedTopics.filter((topic) => laterUpdate?.description.includes(topic.label))).toHaveLength(23);
  });
});
