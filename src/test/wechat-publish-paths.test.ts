import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WechatPublishPathError,
  buildWechatPublishPaths,
  resolveInsideDirectory,
  wechatArticleSlug,
  wechatCoverExtension,
} from '@/lib/wechat-publish-paths';

const contentDir = path.resolve('content/wechat');
const tempDir = path.resolve('.tmp');

function legacySlug(title: string): string {
  return title
    .replace(/[：:，,。.!！？?]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

function expectDirectChild(directory: string, filePath: string, filename: string) {
  const relative = path.relative(directory, filePath);
  expect(relative).toBe(filename);
  expect(relative.includes('..')).toBe(false);
  expect(relative.includes(path.sep)).toBe(false);
  expect(filePath.startsWith(`${directory}${path.sep}`)).toBe(true);
}

describe('wechat publish paths', () => {
  it('keeps the existing filename for a normal Chinese or English title', () => {
    const titles = [
      '冰箱考古学：−20 °C里的时间胶囊',
      'Hello World!',
      '抗体保存，三个误区？',
      'summer lab',
    ];
    for (const title of titles) {
      expect(wechatArticleSlug(title)).toBe(legacySlug(title));
      const result = buildWechatPublishPaths({
        title,
        coverFilename: 'cover.png',
        contentDir,
        tempDir,
        now: 1,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expectDirectChild(contentDir, result.articlePath, `${legacySlug(title)}.md`);
      expectDirectChild(contentDir, result.coverCopyPath, `${legacySlug(title)}-cover.png`);
      expectDirectChild(tempDir, result.tempCoverPath, 'wechat-cover-1.png');
    }
  });

  it('keeps a parent-directory title inside the content directory', () => {
    const title = '../'.repeat(6) + 'etc/passwd';
    const unsafe = path.resolve(contentDir, `${title}.md`);
    expect(path.relative(contentDir, unsafe).startsWith('..')).toBe(true);

    const result = buildWechatPublishPaths({
      title,
      coverFilename: 'cover.png',
      contentDir,
      tempDir,
      now: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectDirectChild(contentDir, result.articlePath, 'etcpasswd.md');
    expectDirectChild(contentDir, result.coverCopyPath, 'etcpasswd-cover.png');
    expectDirectChild(tempDir, result.tempCoverPath, 'wechat-cover-1.png');
  });

  it('does not create nested files from slashes left in the title', () => {
    const title = 'foo/../../../tmp/pwned';
    const result = buildWechatPublishPaths({
      title,
      coverFilename: 'photo.jpg',
      contentDir,
      tempDir,
      now: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectDirectChild(contentDir, result.articlePath, 'footmppwned.md');
    expectDirectChild(contentDir, result.coverCopyPath, 'footmppwned-cover.jpg');
    expect(result.articlePath.includes(`${path.sep}tmp${path.sep}`)).toBe(false);
  });

  it('falls back when the title has no safe characters', () => {
    expect(wechatArticleSlug('../')).toBe('article');
    expect(wechatArticleSlug('？？')).toBe('article');
  });

  it('allowlists cover extensions and ignores the raw suffix', () => {
    expect(wechatCoverExtension('photo.PNG')).toBe('png');
    expect(wechatCoverExtension('photo.jpg')).toBe('jpg');
    expect(wechatCoverExtension('photo.jpeg')).toBe('jpeg');
    expect(wechatCoverExtension('photo.webp')).toBe('webp');
    expect(wechatCoverExtension('../../secret.png')).toBe('png');
    expect(wechatCoverExtension('note.php')).toBeNull();
    expect(wechatCoverExtension('note.svg')).toBeNull();
    expect(wechatCoverExtension('a.jpg.exe')).toBeNull();
    expect(wechatCoverExtension('cover.png/../../../etc/passwd')).toBeNull();
    expect(wechatCoverExtension('a.jpg/hidden.php')).toBeNull();
    expect(wechatCoverExtension('')).toBeNull();
    expect(wechatCoverExtension('png')).toBeNull();

    const rawExtension = 'png/../../../etc/passwd';
    const unsafe = path.resolve(tempDir, `wechat-cover-1.${rawExtension}`);
    expect(path.relative(tempDir, unsafe).startsWith('..')).toBe(true);
    expect(buildWechatPublishPaths({
      title: '正常标题',
      coverFilename: `cover.${rawExtension}`,
      contentDir,
      tempDir,
      now: 1,
    })).toEqual({ ok: false, error: 'unsupported_cover' });

    const smuggled = buildWechatPublishPaths({
      title: '正常标题',
      coverFilename: '..\\..\\secret.JPEG',
      contentDir,
      tempDir,
      now: 3,
    });
    expect(smuggled.ok).toBe(true);
    if (!smuggled.ok) return;
    expect(smuggled.coverExtension).toBe('jpeg');
    expectDirectChild(tempDir, smuggled.tempCoverPath, 'wechat-cover-3.jpeg');
    expect(smuggled.tempCoverPath.includes('..')).toBe(false);
  });

  it('rejects filenames that resolve outside the directory', () => {
    expect(() => resolveInsideDirectory(contentDir, '../outside.md')).toThrow(WechatPublishPathError);
    expect(() => resolveInsideDirectory(contentDir, '/etc/passwd.md')).toThrow(WechatPublishPathError);
    expect(() => resolveInsideDirectory(contentDir, 'nested/file.md')).toThrow(WechatPublishPathError);
    expect(resolveInsideDirectory(contentDir, 'article.md')).toBe(path.join(contentDir, 'article.md'));
  });
});
