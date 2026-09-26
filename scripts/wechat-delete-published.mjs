#!/usr/bin/env node
/**
 * 删除已发表内容并重新上传为草稿
 * 用法: node scripts/wechat-delete-published.mjs <title-keyword>
 * 例如: node scripts/wechat-delete-published.mjs 暑假
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

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

export function findPublishedArticleMatch(items, keyword) {
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    const newsItems = item?.content?.news_item;
    if (!Array.isArray(newsItems)) continue;

    for (const [index, news] of newsItems.entries()) {
      if (typeof news?.title === 'string' && news.title.includes(keyword)) {
        return {
          articleId: item.article_id,
          title: news.title,
          index,
        };
      }
    }
  }

  return null;
}

async function main() {
  const keyword = process.argv[2];
  if (!keyword) {
    console.error('用法: node scripts/wechat-delete-published.mjs <title-keyword>');
    console.error('例如: node scripts/wechat-delete-published.mjs 暑假');
    process.exit(1);
  }

  await loadEnv();
  const appId = process.env.AUTH_WECHAT_MP_ID;
  const secret = process.env.AUTH_WECHAT_MP_SECRET;
  if (!appId || !secret) {
    console.error('Missing AUTH_WECHAT_MP_ID or AUTH_WECHAT_MP_SECRET');
    process.exit(1);
  }

  const token = await getAccessToken(appId, secret);
  console.log('AccessToken 获取成功\n');

  // 1. 查询已发表内容列表
  console.log('=== 查询已发表内容列表 ===');
  const listUrl = new URL(`${API_BASE}/freepublish/batchget`);
  listUrl.searchParams.set('access_token', token);
  const listRes = await fetch(listUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset: 0, count: 20, no_content: 1 }),
  });
  const listData = await listRes.json();
  console.log(`total_count: ${listData.total_count}\n`);

  if (!listData.item || listData.item.length === 0) {
    console.log('已发表内容列表为空，无需删除');
    return;
  }

  // 2. 列出所有已发表内容
  console.log('所有已发表内容:');
  const target = findPublishedArticleMatch(listData.item, keyword);
  for (const item of listData.item) {
    if (item.content && item.content.news_item) {
      for (const [index, news] of item.content.news_item.entries()) {
        const isMatch = news.title.includes(keyword);
        const marker = isMatch ? ' <<<< 匹配' : '';
        console.log(`  article_id: ${item.article_id} | index: ${index} | title: ${news.title}${marker}`);
      }
    }
  }

  if (!target) {
    console.error(`\n未找到标题包含 "${keyword}" 的已发表内容`);
    process.exit(1);
  }

  console.log(`\n即将删除: "${target.title}" (article_id: ${target.articleId}, index: ${target.index})`);

  // 3. 删除已发表内容
  const deleteUrl = new URL(`${API_BASE}/freepublish/delete`);
  deleteUrl.searchParams.set('access_token', token);
  const deleteRes = await fetch(deleteUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      article_id: target.articleId,
      index: target.index,
    }),
  });
  const deleteData = await deleteRes.json();
  console.log('\n=== 删除结果 ===');
  console.log(JSON.stringify(deleteData, null, 2));

  if (deleteData.errcode && deleteData.errcode !== 0) {
    console.error(`\n删除失败: ${deleteData.errcode} ${deleteData.errmsg}`);
    process.exit(1);
  }

  console.log('\n删除成功！该文章已从已发表内容中移除。');
  console.log('现在可以重新上传为草稿，由管理员在后台手动发表。');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
