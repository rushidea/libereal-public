import { describe, it, expect } from 'vitest';
import {
  extractSciencenetImage,
  extractJbrFigureImage,
  extractArticleImageFromHtml,
  isSciencenetContentImage,
} from '@/lib/articleImages';

describe('extractSciencenetImage', () => {
  it('prefers kxwsprint body images over sidebar news uploads', () => {
    const html = `
      <img src="/images/paper.jpg"/>
      <img src="http://rmtzx.sciencenet.cn/kxwsprint/ABC123.jpg"/>
      <img src="https://news.sciencenet.cn//upload/news/images/2026/6/generic.jpg"/>
    `;
    expect(extractSciencenetImage(html, 'http://paper.sciencenet.cn/htmlpaper/test.shtm')).toBe(
      'http://rmtzx.sciencenet.cn/kxwsprint/ABC123.jpg'
    );
  });

  it('extracts paper article images from /upload/paper/images/', () => {
    const html = `
      <img src="/images/paper.jpg"/>
      <img src="/upload/paper/images/2026/6/20266181044208650.jpg"/>
      <img src="https://news.sciencenet.cn//upload/news/images/2026/6/generic.jpg"/>
    `;
    expect(extractSciencenetImage(html, 'http://paper.sciencenet.cn/htmlpaper/test.shtm')).toBe(
      'http://paper.sciencenet.cn/upload/paper/images/2026/6/20266181044208650.jpg'
    );
  });

  it('returns null when only sidebar images are present', () => {
    const html = `
      <img src="/images/newcomm.gif"/>
      <img src="https://news.sciencenet.cn//upload/news/images/2026/6/generic.jpg"/>
    `;
    expect(extractSciencenetImage(html, 'http://paper.sciencenet.cn/htmlpaper/test.shtm')).toBeNull();
  });

  it('rejects sidebar news upload thumbnails as content images', () => {
    expect(
      isSciencenetContentImage(
        'https://news.sciencenet.cn/upload/news/images/2026/6/20266202149205990.jpg'
      )
    ).toBe(false);
    expect(
      isSciencenetContentImage(
        'http://paper.sciencenet.cn/upload/paper/images/2026/6/20266181044208650.jpg'
      )
    ).toBe(true);
  });
});

describe('extractJbrFigureImage', () => {
  it('returns last figList figure filePath from embedded article_meta_data', () => {
    const meta = {
      figList: [
        { sort: 0, filePath: '/fileSWYXYJZZYWB/journal/article/swyxyjzzywb/2026/3/JBR-2025-0137-1.jpg' },
        { sort: 5, filePath: '/fileSWYXYJZZYWB/journal/article/swyxyjzzywb/2026/3/JBR-2025-0137-6.jpg' },
      ],
    };
    const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
    const html = `<script>var article_meta_data = '${encoded}';</script>`;

    expect(extractJbrFigureImage(html)).toBe(
      'http://www.jbr-pub.org.cn/fileSWYXYJZZYWB/journal/article/swyxyjzzywb/2026/3/JBR-2025-0137-6.jpg'
    );
  });

  it('sorts figList by sort field before picking last figure', () => {
    const meta = {
      figList: [
        { sort: 2, filePath: '/fileSWYXYJZZYWB/fig-3.jpg' },
        { sort: 0, filePath: '/fileSWYXYJZZYWB/fig-1.jpg' },
      ],
    };
    const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
    const html = `<script>var article_meta_data = '${encoded}';</script>`;

    expect(extractJbrFigureImage(html)).toBe('http://www.jbr-pub.org.cn/fileSWYXYJZZYWB/fig-3.jpg');
  });

  it('returns the sole figure when figList has one entry', () => {
    const meta = {
      figList: [{ sort: 0, filePath: '/fileSWYXYJZZYWB/only-figure.jpg' }],
    };
    const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
    const html = `<script>var article_meta_data = '${encoded}';</script>`;

    expect(extractJbrFigureImage(html)).toBe(
      'http://www.jbr-pub.org.cn/fileSWYXYJZZYWB/only-figure.jpg'
    );
  });

  it('returns null for editorials with empty figList (cover fallback elsewhere)', () => {
    const meta = { figList: [] };
    const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
    const html = `<script>var article_meta_data = '${encoded}';</script>`;

    expect(extractJbrFigureImage(html)).toBeNull();
  });

  it('falls back to firstFig when figList is absent', () => {
    const meta = {
      firstFig: { filePath: '/fileSWYXYJZZYWB/first-only.jpg' },
    };
    const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
    const html = `<script>var article_meta_data = '${encoded}';</script>`;

    expect(extractJbrFigureImage(html)).toBe(
      'http://www.jbr-pub.org.cn/fileSWYXYJZZYWB/first-only.jpg'
    );
  });
});

describe('extractArticleImageFromHtml', () => {
  it('returns first springer figure instead of last', () => {
    const html = `
      <figure id="fig-1"><img src="https://media.springer-static.com/full/image1.jpg"/></figure>
      <figure id="fig-2"><img src="https://media.springer-static.com/full/image2.jpg"/></figure>
    `;
    expect(extractArticleImageFromHtml(html, 'https://www.nature.com/articles/test')).toBe(
      'https://media.springer-static.com/full/image1.jpg'
    );
  });

  it('ignores og:image when it is not an image URL', () => {
    const html = `<meta property="og:image" content="http://www.jbr-pub.org.cn/"/>`;
    expect(extractArticleImageFromHtml(html, 'http://www.jbr-pub.org.cn/article/doi/test')).toBeNull();
  });

  it('uses last figList figure for JBR URLs and skips og:image', () => {
    const meta = {
      figList: [
        { sort: 0, filePath: '/fileSWYXYJZZYWB/fig-1.jpg' },
        { sort: 1, filePath: '/fileSWYXYJZZYWB/fig-2.jpg' },
      ],
    };
    const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
    const html = `
      <meta property="og:image" content="http://www.jbr-pub.org.cn/catalog/cover/2026/03"/>
      <img src="http://www.jbr-pub.org.cn/some-random-page-image.jpg"/>
      <script>var article_meta_data = '${encoded}';</script>
    `;

    expect(
      extractArticleImageFromHtml(html, 'http://www.jbr-pub.org.cn/article/doi/10.7555/JBR.39.20250406')
    ).toBe('http://www.jbr-pub.org.cn/fileSWYXYJZZYWB/fig-2.jpg');
  });

  it('returns null for JBR editorials without figList even when page has images', () => {
    const meta = { figList: [] };
    const encoded = Buffer.from(JSON.stringify(meta)).toString('base64');
    const html = `
      <meta property="og:image" content="http://www.jbr-pub.org.cn/catalog/cover/2026/03"/>
      <img src="http://www.jbr-pub.org.cn/some-random-page-image.jpg"/>
      <script>var article_meta_data = '${encoded}';</script>
    `;

    expect(
      extractArticleImageFromHtml(html, 'http://www.jbr-pub.org.cn/article/doi/10.7555/JBR.40.20268002')
    ).toBeNull();
  });
});
