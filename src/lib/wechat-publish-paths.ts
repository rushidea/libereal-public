import path from 'node:path';

const COVER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

export type WechatCoverExtension = (typeof COVER_EXTENSIONS)[number];

const COVER_EXTENSION_SET = new Set<string>(COVER_EXTENSIONS);
const MAX_SEGMENT_LENGTH = 120;

export class WechatPublishPathError extends Error {
  constructor() {
    super('UNSAFE_PUBLISH_PATH');
    this.name = 'WechatPublishPathError';
  }
}

function isSafePathSegment(filename: string): boolean {
  if (filename.length === 0 || filename.length > MAX_SEGMENT_LENGTH) return false;
  if (filename === '.' || filename === '..') return false;
  if (/[\u0000-\u001f\u007f]/.test(filename)) return false;
  if (filename.includes('/') || filename.includes('\\')) return false;
  if (filename.split(/[/\\]/).includes('..')) return false;
  return path.posix.basename(filename) === filename && path.win32.basename(filename) === filename;
}

/** Same filename as the previous publisher when the title cannot leave the directory. */
export function wechatArticleSlug(title: string): string {
  const legacy = title
    .replace(/[：:，,。.!！？?]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  if (isSafePathSegment(legacy)) return legacy;

  const sanitized = title
    .replace(/[：:，,。.!！？?]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return isSafePathSegment(sanitized) ? sanitized : 'article';
}

export function wechatCoverExtension(filename: string): WechatCoverExtension | null {
  if (typeof filename !== 'string' || filename.length === 0 || filename.length > 1024) return null;
  if (filename.includes('\0')) return null;
  const base = path.posix.basename(filename.replaceAll('\\', '/'));
  const match = /\.([A-Za-z0-9]+)$/.exec(base);
  if (!match) return null;
  const extension = match[1].toLowerCase();
  if (!COVER_EXTENSION_SET.has(extension)) return null;
  return extension as WechatCoverExtension;
}

export function resolveInsideDirectory(directory: string, filename: string): string {
  if (!isSafePathSegment(filename)) throw new WechatPublishPathError();
  const root = path.resolve(directory);
  const target = path.resolve(root, filename);
  const relative = path.relative(root, target);
  if (relative !== filename || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WechatPublishPathError();
  }
  return target;
}

export function buildWechatPublishPaths(input: {
  title: string;
  coverFilename: string;
  contentDir: string;
  tempDir: string;
  now?: number;
}): {
  ok: true;
  slug: string;
  coverExtension: WechatCoverExtension;
  tempCoverPath: string;
  articlePath: string;
  coverCopyPath: string;
} | { ok: false; error: 'unsupported_cover' } {
  const coverExtension = wechatCoverExtension(input.coverFilename);
  if (!coverExtension) return { ok: false, error: 'unsupported_cover' };

  const slug = wechatArticleSlug(input.title);
  const stamp = input.now ?? Date.now();
  return {
    ok: true,
    slug,
    coverExtension,
    tempCoverPath: resolveInsideDirectory(input.tempDir, `wechat-cover-${stamp}.${coverExtension}`),
    articlePath: resolveInsideDirectory(input.contentDir, `${slug}.md`),
    coverCopyPath: resolveInsideDirectory(input.contentDir, `${slug}-cover.${coverExtension}`),
  };
}
