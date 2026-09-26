import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireAdmin } from '@/lib/session';

const ARTICLES_DIR = join(process.cwd(), 'content', 'wechat');
const ARTICLE_FILE_PATTERN = /^\d{3,}-[a-z0-9-]+\.md$/;

function parseFrontMatter(raw: string): { data: Record<string, string>; body: string; raw: string } | null {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;

  const block = normalized.slice(3, end);
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body, raw: normalized };
}

function listArticles() {
  const files = readdirSync(ARTICLES_DIR).filter((f) => ARTICLE_FILE_PATTERN.test(f));
  return files.map((fileName) => {
    const slug = fileName.replace(/\.md$/, '');
    const raw = readFileSync(join(ARTICLES_DIR, fileName), 'utf8');
    const parsed = parseFrontMatter(raw);
    if (!parsed) return null;
    return {
      slug,
      title: parsed.data.title ?? '',
      date: parsed.data.date ?? '',
      publishedDate: parsed.data.publishedDate ?? '',
      cover: parsed.data.cover ?? '',
      issue: parsed.data.issue ?? '',
      wechatUrl: parsed.data.wechatUrl ?? '',
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
}

function updateFrontMatterField(raw: string, key: string, value: string): string {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return raw;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return raw;

  const beforeBlock = normalized.slice(0, 3);
  const block = normalized.slice(3, end);
  const afterBlock = normalized.slice(end);
  const lines = block.split('\n');

  let found = false;
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    if (colon === -1) return line;
    const k = trimmed.slice(0, colon).trim();
    if (k !== key) return line;
    found = true;
    const indent = line.slice(0, line.length - line.trimStart().length);
    return `${indent}${key}: "${value}"`;
  });

  if (!found) {
    const lastNonEmpty = [...updatedLines].reverse().findIndex((l) => l.trim() !== '');
    const insertIdx = updatedLines.length - lastNonEmpty;
    updatedLines.splice(insertIdx, 0, `${key}: "${value}"`);
  }

  return beforeBlock + updatedLines.join('\n') + afterBlock;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin('content.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const articles = listArticles().sort((a, b) =>
      (b.publishedDate || b.date).localeCompare(a.publishedDate || a.date),
    );
    return NextResponse.json({ articles });
  } catch (e) {
    console.error('[wechat-articles admin] list error:', e);
    return NextResponse.json({ error: '读取文章列表失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin('content.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json();
    const { slug, date, publishedDate, wechatUrl } = body as {
      slug?: string;
      date?: string;
      publishedDate?: string;
      wechatUrl?: string;
    };

    if (!slug || !ARTICLE_FILE_PATTERN.test(`${slug}.md`)) {
      return NextResponse.json({ error: '无效的文章 slug' }, { status: 400 });
    }

    const filePath = join(ARTICLES_DIR, `${slug}.md`);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      return NextResponse.json({ error: '文章文件不存在' }, { status: 404 });
    }

    let updated = raw;
    if (date !== undefined) {
      updated = updateFrontMatterField(updated, 'date', date);
    }
    if (publishedDate !== undefined) {
      updated = updateFrontMatterField(updated, 'publishedDate', publishedDate);
    }
    if (wechatUrl !== undefined) {
      updated = updateFrontMatterField(updated, 'wechatUrl', wechatUrl);
    }

    writeFileSync(filePath, updated, 'utf8');

    return NextResponse.json({ success: true, slug });
  } catch (e) {
    console.error('[wechat-articles admin] patch error:', e);
    return NextResponse.json({ error: '更新文章失败' }, { status: 500 });
  }
}
