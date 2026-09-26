import { describe, expect, it } from 'vitest';

type PublishedArticleMatch = {
  articleId: string;
  title: string;
  index: number;
};

type WechatDeletePublishedModule = {
  findPublishedArticleMatch: (items: unknown[], keyword: string) => PublishedArticleMatch | null;
};

async function loadWechatDeletePublishedModule(): Promise<WechatDeletePublishedModule> {
  return import('../../scripts/wechat-delete-published.mjs') as Promise<WechatDeletePublishedModule>;
}

describe('wechat-delete-published script helpers', () => {
  it('returns the matching article index inside multi-article publish records', async () => {
    const { findPublishedArticleMatch } = await loadWechatDeletePublishedModule();

    const match = findPublishedArticleMatch([
      {
        article_id: 'article-1',
        content: {
          news_item: [
            { title: 'first article' },
            { title: 'target summer article' },
          ],
        },
      },
    ], 'target');

    expect(match).toEqual({
      articleId: 'article-1',
      title: 'target summer article',
      index: 1,
    });
  });
});
