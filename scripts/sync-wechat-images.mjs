#!/usr/bin/env node
/**
 * Sync wechat article images from content/wechat/ to public/wechat/articles/<slug>/.
 *
 * Scans content/wechat/*.md, extracts cover and inline image references from
 * front-matter + markdown body, copies each referenced image into
 * public/wechat/articles/<slug>/.
 *
 * Run after adding a new article or updating images:
 *   node scripts/sync-wechat-images.mjs
 */

import { readdirSync, readFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'content', 'wechat');
const DST_DIR = join(ROOT, 'public', 'wechat', 'articles');

const ARTICLE_FILE_PATTERN = /^\d{3,}-[a-z0-9-]+\.md$/;

function parseFrontMatter(raw) {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = normalized.slice(3, end).trim();
  const bodyStart = normalized.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : normalized.slice(bodyStart + 1);
  const data = {};
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
  return { data, body };
}

function extractImages(data, body) {
  const images = [];
  const cover = data.cover?.trim();
  if (cover && !/^(https?:)?\/\//.test(cover) && !cover.startsWith('/')) {
    images.push(cover);
  }
  const imgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of body.matchAll(imgRegex)) {
    const src = match[1];
    if (!/^(https?:)?\/\//.test(src) && !src.startsWith('/') && !images.includes(src)) {
      images.push(src);
    }
  }
  return images;
}

function main() {
  const files = readdirSync(SRC_DIR).filter((f) => ARTICLE_FILE_PATTERN.test(f));
  if (files.length === 0) {
    console.log('No article files found.');
    return;
  }

  let copied = 0;
  let skipped = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const raw = readFileSync(join(SRC_DIR, file), 'utf8');
    const parsed = parseFrontMatter(raw);
    if (!parsed) continue;
    const images = extractImages(parsed.data, parsed.body);
    if (images.length === 0) continue;

    const dstSlugDir = join(DST_DIR, slug);
    if (!existsSync(dstSlugDir)) mkdirSync(dstSlugDir, { recursive: true });

    for (const img of images) {
      const src = join(SRC_DIR, img);
      const dst = join(dstSlugDir, img);
      if (!existsSync(src)) {
        console.warn(`  [skip] ${slug}: source not found: ${img}`);
        skipped++;
        continue;
      }
      copyFileSync(src, dst);
      console.log(`  [copy] ${slug}/${img}`);
      copied++;
    }
  }

  console.log(`\nDone: ${copied} copied, ${skipped} skipped.`);
}

main();
