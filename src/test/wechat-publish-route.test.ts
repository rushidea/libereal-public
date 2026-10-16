import { File } from 'node:buffer';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { FormData } from 'undici';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  uploadCoverImage: vi.fn(),
  createDraft: vi.fn(),
  publishDraft: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/wechat-publish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wechat-publish')>();
  return {
    ...actual,
    uploadCoverImage: mocks.uploadCoverImage,
    createDraft: mocks.createDraft,
    publishDraft: mocks.publishDraft,
  };
});

import { POST } from '@/app/api/admin/wechat-publish/route';

function publishRequest(input: {
  markdown: string;
  coverName: string;
  publish?: string;
  saveCopy?: string;
}) {
  const form = new FormData();
  form.set('article', new File([input.markdown], 'article.md', { type: 'text/markdown' }));
  form.set('cover', new File([Uint8Array.from([137, 80, 78, 71])], input.coverName, { type: 'image/png' }));
  if (input.publish) form.set('publish', input.publish);
  if (input.saveCopy) form.set('saveCopy', input.saveCopy);
  return new NextRequest('http://localhost/api/admin/wechat-publish', {
    method: 'POST',
    body: form as unknown as BodyInit,
  });
}

function listFiles(directory: string): string[] {
  const found: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.push(full);
    }
  };
  try {
    visit(directory);
  } catch {
    return [];
  }
  return found.sort();
}

function expectDirectChild(directory: string, filename: string) {
  const filePath = path.join(directory, filename);
  expect(path.relative(directory, filePath)).toBe(filename);
  expect(readFileSync(filePath).length).toBeGreaterThan(0);
  return filePath;
}

describe('POST /api/admin/wechat-publish', () => {
  let root = '';
  let nowSpy: MockInstance;
  let cwdSpy: MockInstance;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'wechat-publish-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1);
    mocks.requireAdmin.mockReset();
    mocks.uploadCoverImage.mockReset();
    mocks.createDraft.mockReset();
    mocks.publishDraft.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin_1', email: 'admin@example.com', role: 'admin' });
    mocks.uploadCoverImage.mockResolvedValue({ mediaId: 'cover-media', url: 'https://example.test/cover.png' });
    mocks.createDraft.mockResolvedValue({ mediaId: 'draft-media' });
    mocks.publishDraft.mockResolvedValue({ publishId: 'publish-1' });
  });

  afterEach(() => {
    nowSpy.mockRestore();
    cwdSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns 401 and does not write files without content.write', async () => {
    mocks.requireAdmin.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    const response = await POST(publishRequest({
      markdown: '# 正常标题\n\n正文',
      coverName: 'cover.png',
    }));
    expect(response.status).toBe(401);
    expect(mocks.requireAdmin).toHaveBeenCalledWith('content.write');
    expect(mocks.uploadCoverImage).not.toHaveBeenCalled();
  });

  it('rejects a cover extension outside the allowlist before writing', async () => {
    const response = await POST(publishRequest({
      markdown: '# 正常标题\n\n正文',
      coverName: 'cover.png/../../../etc/passwd',
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '封面只支持 png、jpg、jpeg 或 webp 图片' });
    expect(mocks.uploadCoverImage).not.toHaveBeenCalled();
    expect(listFiles(root)).toEqual([]);
  });

  it('saves a traversal title only inside content/wechat', async () => {
    const response = await POST(publishRequest({
      markdown: `# ${'../'.repeat(6)}etc/passwd\n\n正文`,
      coverName: '../../secret.png',
      publish: 'true',
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      draftMediaId: 'draft-media',
      published: true,
      publishId: 'publish-1',
    });

    const contentDir = path.join(root, 'content', 'wechat');
    const tempDir = path.join(root, '.tmp');
    expect(readFileSync(expectDirectChild(contentDir, 'etcpasswd.md'), 'utf8')).toContain('正文');
    expectDirectChild(contentDir, 'etcpasswd-cover.png');
    const tempCover = expectDirectChild(tempDir, 'wechat-cover-1.png');
    expect(listFiles(root)).toEqual([
      path.join(contentDir, 'etcpasswd-cover.png'),
      path.join(contentDir, 'etcpasswd.md'),
      tempCover,
    ].sort());
    expect(mocks.uploadCoverImage).toHaveBeenCalledWith(tempCover);
    expect(mocks.publishDraft).toHaveBeenCalledWith('draft-media');
  });

  it('still publishes a normal article and keeps the previous filename', async () => {
    const response = await POST(publishRequest({
      markdown: '# 冰箱考古学：−20 °C里的时间胶囊\n\n正文',
      coverName: 'cover.jpg',
    }));
    expect(response.status).toBe(200);
    const slug = '冰箱考古学−20-°C里的时间胶囊';
    const contentDir = path.join(root, 'content', 'wechat');
    expect(readFileSync(expectDirectChild(contentDir, `${slug}.md`), 'utf8')).toContain('# 冰箱考古学');
    expectDirectChild(contentDir, `${slug}-cover.jpg`);
    expectDirectChild(path.join(root, '.tmp'), 'wechat-cover-1.jpg');
    expect(mocks.publishDraft).not.toHaveBeenCalled();
  });

  it('skips the content copy without writing outside the temp directory', async () => {
    const response = await POST(publishRequest({
      markdown: '# Hello World!\n\n正文',
      coverName: 'cover.webp',
      saveCopy: 'false',
    }));
    expect(response.status).toBe(200);
    expectDirectChild(path.join(root, '.tmp'), 'wechat-cover-1.webp');
    expect(() => readFileSync(path.join(root, 'content', 'wechat', 'Hello-World.md'))).toThrow();
  });
});
