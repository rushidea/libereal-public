#!/usr/bin/env node
/**
 * 临时诊断脚本：查询已发表内容状态
 * 用法: node scripts/wechat-check-publish.mjs
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

async function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.error('Error: .env not found');
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
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`getAccessToken failed: ${data.errcode} ${data.errmsg}`);
  }
  return data.access_token;
}

async function main() {
  await loadEnv();
  const appId = process.env.AUTH_WECHAT_MP_ID;
  const secret = process.env.AUTH_WECHAT_MP_SECRET;
  if (!appId || !secret) {
    console.error('Missing AUTH_WECHAT_MP_ID or AUTH_WECHAT_MP_SECRET');
    process.exit(1);
  }

  const token = await getAccessToken(appId, secret);
  console.log('=== AccessToken 获取成功 ===\n');

  // 1. 查询特定 publish_id 的状态 (002 重新发布后的 publish_id)
  const publishId = '2247483736';
  console.log(`=== 查询 publish_id=${publishId} 的发布状态 ===`);
  const checkUrl = new URL(`${API_BASE}/freepublish/get`);
  checkUrl.searchParams.set('access_token', token);
  const checkRes = await fetch(checkUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const checkData = await checkRes.json();
  console.log(JSON.stringify(checkData, null, 2));
  console.log('');

  // 2. 查询已发表内容列表
  console.log('=== 查询已发表内容列表 (freepublish/batchget) ===');
  const listUrl = new URL(`${API_BASE}/freepublish/batchget`);
  listUrl.searchParams.set('access_token', token);
  const listRes = await fetch(listUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset: 0, count: 20, no_content: 1 }),
  });
  const listData = await listRes.json();
  console.log(`total_count: ${listData.total_count}`);
  console.log(`item_count: ${listData.item_count}`);
  if (listData.item) {
    for (const item of listData.item) {
      console.log(`\n--- article_id: ${item.article_id} ---`);
      if (item.content && item.content.news_item) {
        for (const news of item.content.news_item) {
          console.log(`  title: ${news.title}`);
          console.log(`  author: ${news.author}`);
          console.log(`  update_time: ${item.content.update_time} (${new Date(item.content.update_time * 1000).toLocaleString('zh-CN')})`);
          console.log(`  url: ${news.url || '(无URL)'}`);
        }
      }
    }
  } else {
    console.log('已发表内容列表为空！');
  }

  // 3. 也查询草稿列表
  console.log('\n=== 查询草稿列表 (draft/batchget) ===');
  const draftUrl = new URL(`${API_BASE}/draft/batchget`);
  draftUrl.searchParams.set('access_token', token);
  const draftRes = await fetch(draftUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset: 0, count: 20, no_content: 1 }),
  });
  const draftData = await draftRes.json();
  console.log(`total_count: ${draftData.total_count}`);
  console.log(`item_count: ${draftData.item_count}`);
  if (draftData.item) {
    for (const item of draftData.item) {
      console.log(`\n--- media_id: ${item.media_id} ---`);
      if (item.content && item.content.news_item) {
        for (const news of item.content.news_item) {
          console.log(`  title: ${news.title}`);
          console.log(`  update_time: ${item.content.update_time} (${new Date(item.content.update_time * 1000).toLocaleString('zh-CN')})`);
        }
      }
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
