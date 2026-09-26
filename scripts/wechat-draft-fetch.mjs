#!/usr/bin/env node
/**
 * WeChat draft box fetcher.
 *
 * Usage:
 *   node scripts/wechat-draft-fetch.mjs list
 *   node scripts/wechat-draft-fetch.mjs get <media_id> [--out <file.json>]
 *
 * Requires .env with AUTH_WECHAT_MP_ID and AUTH_WECHAT_MP_SECRET.
 * The calling IP must be in the WeChat IP whitelist.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

async function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.error('Error: .env not found. Run from project root.');
    process.exit(1);
  }
  const content = await readFile(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const API_BASE = 'https://api.weixin.qq.com/cgi-bin';

async function getAccessToken(appId, secret) {
  const url = new URL(`${API_BASE}/token`);
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', secret);
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }
  return data.access_token;
}

async function batchGet(accessToken, offset = 0, count = 20, noContent = 1) {
  const url = new URL(`${API_BASE}/draft/batchget`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset, count, no_content: noContent }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`获取草稿列表失败: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

async function getDraft(accessToken, mediaId) {
  const url = new URL(`${API_BASE}/draft/get`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`获取草稿失败: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

async function main() {
  await loadEnv();
  const appId = process.env.AUTH_WECHAT_MP_ID;
  const secret = process.env.AUTH_WECHAT_MP_SECRET;
  if (!appId || !secret) {
    console.error('Error: AUTH_WECHAT_MP_ID / AUTH_WECHAT_MP_SECRET missing in .env');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'list';
  const accessToken = await getAccessToken(appId, secret);

  if (cmd === 'list') {
    const data = await batchGet(accessToken, 0, 20, 1);
    console.log(`总数: ${data.total_count}`);
    for (const item of data.item ?? []) {
      const news = item.content?.news_item ?? [];
      for (const n of news) {
        console.log(`media_id: ${item.media_id}`);
        console.log(`  title  : ${n.title}`);
        console.log(`  digest : ${n.digest}`);
        console.log(`  thumb  : ${n.thumb_media_id}`);
        console.log(`  updated: ${new Date((item.content?.update_time ?? 0) * 1000).toISOString()}`);
      }
    }
    return;
  }

  if (cmd === 'get') {
    const mediaId = args[1];
    if (!mediaId) {
      console.error('Usage: node scripts/wechat-draft-fetch.mjs get <media_id> [--out <file.json>]');
      process.exit(1);
    }
    const outIdx = args.indexOf('--out');
    const data = await getDraft(accessToken, mediaId);
    const json = JSON.stringify(data, null, 2);
    if (outIdx !== -1 && args[outIdx + 1]) {
      await writeFile(args[outIdx + 1], json, 'utf-8');
      console.log(`Saved to ${args[outIdx + 1]}`);
    } else {
      console.log(json);
    }
    return;
  }

  if (cmd === 'delete') {
    const mediaId = args[1];
    if (!mediaId) {
      console.error('Usage: node scripts/wechat-draft-fetch.mjs delete <media_id>');
      process.exit(1);
    }
    const url = new URL(`${API_BASE}/draft/delete`);
    url.searchParams.set('access_token', accessToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id: mediaId }),
      cache: 'no-store',
    });
    const data = await res.json();
    if (data.errcode) {
      throw new Error(`删除草稿失败: ${data.errcode} ${data.errmsg}`);
    }
    console.log(`已删除草稿 ${mediaId}`);
    return;
  }

  if (cmd === 'published') {
    const url = new URL(`${API_BASE}/freepublish/batchget`);
    url.searchParams.set('access_token', accessToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: 0, count: 20, no_content: 0 }),
      cache: 'no-store',
    });
    const data = await res.json();
    if (data.errcode) {
      throw new Error(`获取已发布列表失败: ${data.errcode} ${data.errmsg}`);
    }
    const outIdx = args.indexOf('--out');
    if (outIdx !== -1 && args[outIdx + 1]) {
      await writeFile(args[outIdx + 1], JSON.stringify(data, null, 2), 'utf-8');
      console.log(`Saved to ${args[outIdx + 1]}`);
    }
    console.log(`已发布总数: ${data.total_count}`);
    for (const item of data.item ?? []) {
      for (const n of item.content?.news_item ?? []) {
        console.log(`article_id: ${item.article_id}`);
        console.log(`  title  : ${n.title}`);
        console.log(`  url    : ${n.url}`);
        console.log(`  updated: ${new Date((item.content?.update_time ?? 0) * 1000).toISOString()}`);
      }
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
