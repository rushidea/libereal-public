import 'server-only';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { WechatArticle, WechatArticleMeta } from '@/data/wechat-articles';
import { renderArticleMarkdown } from '@/lib/seo/article-markdown';

const ARTICLES_DIR = join(process.cwd(), 'content', 'wechat');
/** 仅以三位数字编号开头的 .md 文件视为文章，排除 CONTENT-CALENDAR.md 等辅助文件。 */
const ARTICLE_FILE_PATTERN = /^\d{3,}-[a-z0-9-]+\.md$/;

type ParsedFrontMatter = {
  data: Record<string, string>;
  body: string;
};

/**
 * 极简 front-matter 解析：读取文件开头以 --- 包裹的键值块。
 * 只支持 `key: value` 单行形式，足够本项目文章元数据使用，避免新增 YAML 依赖。
 */
function parseFrontMatter(raw: string): ParsedFrontMatter | null {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;

  const block = normalized.slice(3, end).trim();
  const bodyStart = normalized.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : normalized.slice(bodyStart + 1);

  const data: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body };
}

/** 文章图片在 public/ 下的基础路径前缀，用于站内图片 URL 生成。 */
const ARTICLE_IMAGE_BASE = '/wechat/articles';

/** 把正文中非绝对地址的图片引用补全为 /wechat/articles/<slug>/ 下的站内地址。 */
function resolveImagePaths(html: string, slug: string): string {
  return html.replace(/<img([^>]*?)src="([^"]+)"/g, (match, attrs, src) => {
    if (/^(https?:)?\/\//.test(src) || src.startsWith('/') || src.startsWith('data:')) {
      return match;
    }
    return `<img${attrs}src="${ARTICLE_IMAGE_BASE}/${slug}/${src}"`;
  });
}

function toMeta(slug: string, data: Record<string, string>): WechatArticleMeta | null {
  const title = data.title?.trim();
  const date = data.date?.trim();
  const cover = data.cover?.trim();
  const summary = data.summary?.trim();
  if (!title || !date || !cover || !summary) return null;

  const coverPath = /^(https?:)?\/\//.test(cover) || cover.startsWith('/')
    ? cover
    : `${ARTICLE_IMAGE_BASE}/${slug}/${cover}`;

  return {
    slug,
    title,
    date,
    publishedDate: data.publishedDate?.trim() || undefined,
    dateModified: data.dateModified?.trim() || data.updatedDate?.trim() || undefined,
    cover: coverPath,
    summary,
    issue: data.issue?.trim() || undefined,
    wechatUrl: data.wechatUrl?.trim() || undefined,
    wechatFirst: data.wechatFirst?.trim().toLowerCase() !== 'false',
  };
}

function readArticleFiles(): string[] {
  try {
    return readdirSync(ARTICLES_DIR).filter((name) => ARTICLE_FILE_PATTERN.test(name));
  } catch {
    return [];
  }
}

function loadArticle(fileName: string): WechatArticle | null {
  const slug = fileName.replace(/\.md$/, '');
  let raw: string;
  try {
    raw = readFileSync(join(ARTICLES_DIR, fileName), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseFrontMatter(raw);
  if (!parsed) return null;
  const meta = toMeta(slug, parsed.data);
  if (!meta) return null;
  // 正文开头的 H1 与 frontmatter title 重复，页面已有自己的 <h1>，渲染时去掉。
  const bodyWithoutTitleH1 = parsed.body.replace(/^#{1}\s+.+\n?/, '');
  const contentHtml = resolveImagePaths(renderArticleMarkdown(bodyWithoutTitleH1), slug);
  return { ...meta, contentHtml };
}

/** 排序键：有 publishedDate 时优先使用，否则回退到 date。 */
function sortKey(meta: WechatArticleMeta): string {
  return meta.publishedDate ?? meta.date;
}

/** 读取全部文章元数据，按发表日期倒序（publishedDate 优先于 date）。 */
export function getAllWechatArticleMetas(): WechatArticleMeta[] {
  return readArticleFiles()
    .map((fileName) => {
      const slug = fileName.replace(/\.md$/, '');
      const parsed = parseFrontMatter(readFileSyncSafe(join(ARTICLES_DIR, fileName)));
      if (!parsed) return null;
      return toMeta(slug, parsed.data);
    })
    .filter((meta): meta is WechatArticleMeta => meta !== null)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

function readFileSyncSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** 读取单篇完整文章（含正文 HTML）。找不到返回 null。 */
export function getWechatArticleBySlug(slug: string): WechatArticle | null {
  if (!ARTICLE_FILE_PATTERN.test(`${slug}.md`)) return null;
  return loadArticle(`${slug}.md`);
}

/** 返回全部文章 slug，供 generateStaticParams 使用。 */
export function getAllWechatArticleSlugs(): string[] {
  return getAllWechatArticleMetas().map((meta) => meta.slug);
}
