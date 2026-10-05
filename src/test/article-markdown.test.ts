import { describe, expect, it } from 'vitest';
import { renderArticleMarkdown } from '@/lib/seo/article-markdown';

describe('renderArticleMarkdown', () => {
  it('moves article body headings down one level and caps them at h6', () => {
    const html = renderArticleMarkdown('# Section one\n\n## Section two\n\n### Section three\n\n#### Section four\n\n##### Section five\n\n###### Section six');
    expect(html).toContain('<h2>Section one</h2>');
    expect(html).toContain('<h3>Section two</h3>');
    expect(html).toContain('<h4>Section three</h4>');
    expect(html).toContain('<h5>Section four</h5>');
    expect(html).toContain('<h6>Section five</h6>');
    expect(html).toContain('<h6>Section six</h6>');
    expect(html).not.toContain('<h1>');
  });

  it('keeps raw HTML escaped and preserves Markdown links and images', () => {
    const html = renderArticleMarkdown('[reference](https://example.com)\n\n![figure](diagram.png)\n\n<script>alert(1)</script>');
    expect(html).toContain('<a href="https://example.com">reference</a>');
    expect(html).toContain('<img src="diagram.png" alt="figure"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
