import MarkdownIt from 'markdown-it';

const articleMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

articleMarkdown.core.ruler.after('inline', 'demote-article-headings', (state) => {
  for (const token of state.tokens) {
    if ((token.type !== 'heading_open' && token.type !== 'heading_close') || !/^h[1-6]$/.test(token.tag)) {
      continue;
    }
    const level = Number(token.tag.slice(1));
    token.tag = `h${Math.min(level + 1, 6)}`;
  }
});

/** Render article Markdown with body headings below the page's own H1. */
export function renderArticleMarkdown(markdown: string): string {
  return articleMarkdown.render(markdown);
}
