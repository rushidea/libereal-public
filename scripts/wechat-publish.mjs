#!/usr/bin/env node
/**
 * WeChat Official Account publisher CLI.
 *
 * Usage:
 *   node scripts/wechat-publish.mjs <article.md> [--cover <cover.png>] [--publish] [--author <name>]
 *
 * Reads the article markdown and cover image, uploads to WeChat draft box,
 * and optionally publishes.
 *
 * Requires .env with AUTH_WECHAT_MP_ID and AUTH_WECHAT_MP_SECRET.
 * The calling IP must be in the WeChat IP whitelist.
 *
 * Examples:
 *   # Create draft only (default)
 *   node scripts/wechat-publish.mjs content/wechat/001-freezer-archaeology.md
 *
 *   # Create draft and publish immediately
 *   node scripts/wechat-publish.mjs content/wechat/001-freezer-archaeology.md --publish
 *
 *   # Specify cover image explicitly
 *   node scripts/wechat-publish.mjs content/wechat/001-freezer-archaeology.md --cover content/wechat/001-freezer-archaeology-cover.png
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Load .env manually (no dotenv dependency)
// ---------------------------------------------------------------------------

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
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { articlePath: null, coverPath: null, publish: false, author: '天放生物', thumbMediaId: null, dryRun: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--publish') opts.publish = true;
    else if (args[i] === '--cover') opts.coverPath = args[++i];
    else if (args[i] === '--author') opts.author = args[++i];
    else if (args[i] === '--thumb-media-id') opts.thumbMediaId = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'stdout';
    else if (!opts.articlePath) opts.articlePath = args[i];
  }
  return opts;
}

// ---------------------------------------------------------------------------
// WeChat API
// ---------------------------------------------------------------------------

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

async function uploadImage(accessToken, imagePath) {
  const buffer = await readFile(imagePath);
  const filename = basename(imagePath);
  // Use add_material (permanent) for cover image — returns media_id for thumb_media_id
  const url = new URL(`${API_BASE}/material/add_material`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('type', 'image');
  const formData = new FormData();
  formData.append('media', new Blob([buffer]), filename);
  const res = await fetch(url, { method: 'POST', body: formData, cache: 'no-store' });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`上传图片失败: ${data.errcode} ${data.errmsg}`);
  }
  return { mediaId: data.media_id, url: data.url ?? '' };
}

async function uploadContentImage(accessToken, imagePath) {
  // media/uploadimg returns { url } only — for images embedded inside article content
  const buffer = await readFile(imagePath);
  const filename = basename(imagePath);
  const url = new URL(`${API_BASE}/media/uploadimg`);
  url.searchParams.set('access_token', accessToken);
  const formData = new FormData();
  formData.append('media', new Blob([buffer]), filename);
  const res = await fetch(url, { method: 'POST', body: formData, cache: 'no-store' });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`上传正文图片失败: ${data.errcode} ${data.errmsg}`);
  }
  return data.url;
}

async function processInlineImages(md, accessToken, articleDir) {
  // Find all ![alt](path) where path is not http(s)
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...md.matchAll(imgRegex)];
  const localImages = matches.filter(m => !m[2].startsWith('http'));
  if (localImages.length === 0) return md;

  let result = md;
  for (const match of localImages) {
    const [full, alt, localPath] = match;
    const absPath = resolve(articleDir, localPath);
    if (!existsSync(absPath)) {
      console.warn(`   跳过（文件不存在）: ${localPath}`);
      continue;
    }
    console.log(`   上传正文图片: ${basename(absPath)}`);
    const wechatUrl = await uploadContentImage(accessToken, absPath);
    result = result.replace(full, `![${alt}](${wechatUrl})`);
  }
  return result;
}

async function createDraft(accessToken, article) {
  const url = new URL(`${API_BASE}/draft/add`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles: [article] }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`创建草稿失败: ${data.errcode} ${data.errmsg}`);
  }
  return data.media_id;
}

async function publishDraft(accessToken, mediaId) {
  const url = new URL(`${API_BASE}/freepublish/submit`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`发布失败: ${data.errcode} ${data.errmsg}`);
  }
  return data.publish_id;
}

// ---------------------------------------------------------------------------
// Markdown → WeChat HTML
// ---------------------------------------------------------------------------

const STYLE_P = 'margin:0 0 1em;padding:0;font-size:16px;line-height:1.8;color:#3f3f3f;letter-spacing:0.5px;text-align:left;';
const STYLE_H2 = 'margin:1.8em 0 0.6em;padding:0;font-size:19px;font-weight:bold;color:#1a1a1a;border-bottom:1px solid #e8e8e8;padding-bottom:6px;text-align:left;';
const STYLE_H3 = 'margin:1.4em 0 0.5em;padding:0;font-size:17px;font-weight:bold;color:#1a1a1a;text-align:left;';
const STYLE_STRONG = 'color:#1a1a1a;';
const STYLE_BLOCKQUOTE = 'margin:1em 0;padding:10px 14px;background:#f7f7f7;border-left:3px solid #ccc;font-size:15px;color:#888;line-height:1.7;text-align:left;';
const STYLE_HR = 'border:none;border-top:1px solid #e0e0e0;margin:2em 0;';
const STYLE_UL = 'margin:0 0 1em;padding-left:1.4em;font-size:16px;line-height:1.8;color:#3f3f3f;text-align:left;';
const STYLE_LI = 'margin-bottom:0.4em;';
const STYLE_A = 'color:#576b95;text-decoration:none;';
const STYLE_IMG = 'max-width:100%;border-radius:8px;margin:1.2em auto;display:block;';
const STYLE_FOOTER = 'margin-top:2em;padding:14px;background:#f7f7f7;border-radius:6px;font-size:14px;color:#888;line-height:1.6;text-align:left;';
const STYLE_CREDITS = 'margin-top:0.6em;padding:0 14px;font-size:14px;color:#999;line-height:1.8;text-align:left;';
const STYLE_COPYRIGHT = 'margin-top:0.4em;padding:0 14px;font-size:12px;color:#bbb;line-height:1.6;text-align:left;';

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function processInline(text) {
  let result = escapeHtml(text);
  result = result.replace(/\*\*(.+?)\*\*/g, `<strong style="${STYLE_STRONG}">$1</strong>`);
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  result = result.replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:14px;">$1</code>');
  result = result.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="${STYLE_A}">$1</a>`);
  return result;
}

function markdownToWechatHtml(md) {
  const lines = md.split('\n');
  const htmlParts = [];
  let inList = false;
  let listType = null;
  let inBlockquote = false;
  let blockquoteLines = [];
  let inFooter = false;
  let footerLines = [];
  let afterHr = false;

  // Footer starts at the LAST horizontal rule only. Any earlier `---` is a
  // normal section separator inside the body and must not turn the remaining
  // text into footer-styled (small grey) blocks.
  let lastHrIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^---+$/.test(t) || /^\*\*\*+$/.test(t)) lastHrIndex = i;
  }

  const closeList = () => {
    if (inList && listType) {
      htmlParts.push(`</${listType}>`);
      inList = false;
      listType = null;
    }
  };
  const closeBlockquote = () => {
    if (inBlockquote) {
      const content = blockquoteLines.map(l => processInline(l)).join('<br/>');
      htmlParts.push(`<blockquote style="${STYLE_BLOCKQUOTE}">${content}</blockquote>`);
      inBlockquote = false;
      blockquoteLines = [];
    }
  };
  const closeFooter = () => {
    if (inFooter) {
      const content = footerLines.map(l => processInline(l)).join('<br/>');
      htmlParts.push(`<div style="${STYLE_FOOTER}">${content}</div>`);
      inFooter = false;
      footerLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (i === 0 && trimmed.startsWith('# ')) continue;

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      closeList(); closeBlockquote(); closeFooter();
      if (i === lastHrIndex) afterHr = true;
      htmlParts.push(`<hr style="${STYLE_HR}"/>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      closeList(); closeBlockquote(); closeFooter();
      htmlParts.push(`<h2 style="${STYLE_H2}">${processInline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      closeList(); closeBlockquote(); closeFooter();
      htmlParts.push(`<h3 style="${STYLE_H3}">${processInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('> ')) {
      closeList();
      if (!inBlockquote) { inBlockquote = true; blockquoteLines = []; }
      blockquoteLines.push(trimmed.slice(2));
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      closeBlockquote(); closeFooter();
      if (!inList || listType !== 'ul') { closeList(); inList = true; listType = 'ul'; htmlParts.push(`<ul style="${STYLE_UL}">`); }
      htmlParts.push(`<li style="${STYLE_LI}">${processInline(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      closeBlockquote(); closeFooter();
      if (!inList || listType !== 'ol') { closeList(); inList = true; listType = 'ol'; htmlParts.push(`<ol style="${STYLE_UL}">`); }
      htmlParts.push(`<li style="${STYLE_LI}">${processInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    if (trimmed === '') { closeList(); closeBlockquote(); continue; }
    // Image-only line: ![alt](url)
    if (/^!\[.*\]\(.+\)$/.test(trimmed)) {
      closeList(); closeBlockquote(); closeFooter();
      const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        htmlParts.push(`<img src="${imgMatch[2]}" alt="${imgMatch[1]}" style="${STYLE_IMG}" />`);
      }
      continue;
    }
    // After --- separator, all text lines go into footer (14px uniform)
    if (afterHr && trimmed !== '' && !/^!\[.*\]\(.+\)$/.test(trimmed)) {
      closeList(); closeBlockquote();
      if (!inFooter) { inFooter = true; footerLines = []; }
      footerLines.push(trimmed);
      continue;
    }
    closeList(); closeBlockquote(); closeFooter();
    htmlParts.push(`<p style="${STYLE_P}">${processInline(trimmed)}</p>`);
  }
  closeList(); closeBlockquote(); closeFooter();
  return htmlParts.join('\n');
}

// ---------------------------------------------------------------------------
// Parse article markdown
// ---------------------------------------------------------------------------

function parseArticle(md) {
  const lines = md.split('\n');
  let title = '';
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('# ')) { title = trimmed.slice(2).trim(); startIdx = i + 1; break; }
  }
  let digest = '';
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('> ')) {
      const meta = trimmed.slice(2);
      const parts = meta.split('|').map(p => p.trim());
      for (const part of parts) {
        if (part.startsWith('字数')) continue;
        const colonIdx = part.indexOf('：');
        if (colonIdx > -1) {
          digest = digest ? `${digest}，${part.slice(colonIdx + 1).trim()}` : part.slice(colonIdx + 1).trim();
        }
      }
      startIdx = i + 1;
      break;
    }
    if (trimmed === '' || trimmed === '---') continue;
    if (!digest && trimmed && !trimmed.startsWith('#')) { digest = trimmed.slice(0, 54); break; }
  }
  const bodyHtml = markdownToWechatHtml(lines.slice(startIdx).join('\n'));
  // Auto-append email footer only; byline (撰稿：X | 编辑：Sea | 校对：Peter) is in the markdown body
  const creditsHtml = `<div style="${STYLE_CREDITS}">投稿邮箱：<a href="mailto:info@libereal.cn" style="${STYLE_A}">info@libereal.cn</a>，站内用户可获得至高50积分。</div>`;
  return { title, digest: digest || title, bodyHtml, creditsHtml, html: bodyHtml + '\n' + creditsHtml };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await loadEnv();
  const opts = parseArgs();

  if (!opts.articlePath) {
    console.error('Usage: node scripts/wechat-publish.mjs <article.md> [--cover <cover.png>] [--publish] [--author <name>]');
    process.exit(1);
  }

  const articlePath = resolve(opts.articlePath);
  if (!existsSync(articlePath)) {
    console.error(`Error: Article not found: ${articlePath}`);
    process.exit(1);
  }

  // Auto-detect cover image if not specified
  let coverPath = opts.coverPath;
  if (!coverPath) {
    const base = articlePath.replace(/\.md$/, '');
    for (const ext of ['-cover.png', '-cover.jpg', '-cover.jpeg', '.png', '.jpg']) {
      const candidate = base + ext;
      if (existsSync(candidate)) { coverPath = candidate; break; }
    }
  }
  // Dry run: render the article HTML locally without touching the WeChat API.
  // Inline images keep their local paths so the layout can be inspected offline.
  if (opts.dryRun) {
    const mdLocal = await readFile(articlePath, 'utf-8');
    const parsedLocal = parseArticle(mdLocal);
    const preview = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${parsedLocal.title}</title></head>`
      + `<body style="max-width:677px;margin:0 auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;">`
      + `<h1 style="font-size:22px;line-height:1.4;">${parsedLocal.title}</h1>`
      + `<p style="color:#999;font-size:13px;">${parsedLocal.digest}</p>`
      + parsedLocal.html + `</body></html>`;
    if (opts.dryRun === 'stdout') {
      console.log(preview);
    } else {
      await writeFile(opts.dryRun, preview, 'utf-8');
      console.log(`Dry run written to ${opts.dryRun}`);
    }
    return;
  }

  if (!opts.thumbMediaId && (!coverPath || !existsSync(coverPath))) {
    console.error('Error: Cover image not found. Use --cover to specify, or reuse an existing cover via --thumb-media-id.');
    process.exit(1);
  }

  const appId = process.env.AUTH_WECHAT_MP_ID?.trim();
  const secret = process.env.AUTH_WECHAT_MP_SECRET?.trim();
  if (!appId || !secret) {
    console.error('Error: AUTH_WECHAT_MP_ID / AUTH_WECHAT_MP_SECRET not set in .env');
    process.exit(1);
  }

  console.log('--- WeChat Publisher ---');
  console.log(`Article: ${articlePath}`);
  console.log(`Cover:   ${coverPath}`);
  console.log(`Author:  ${opts.author}`);
  console.log(`Publish: ${opts.publish}`);
  console.log('');

  // 1. Read article
  const md = await readFile(articlePath, 'utf-8');
  console.log(`Title:   (parsing...)`);
  console.log('');

  // 2. Get access_token
  console.log('1/5 获取 access_token...');
  const accessToken = await getAccessToken(appId, secret);
  console.log('   OK');

  // 3. Upload inline content images (replace local paths with WeChat URLs)
  console.log('2/5 上传正文图片...');
  const articleDir = dirname(articlePath);
  const processedMd = await processInlineImages(md, accessToken, articleDir);
  console.log('   OK');

  // 4. Parse article (now with WeChat image URLs)
  const parsed = parseArticle(processedMd);
  console.log(`   Title:  ${parsed.title}`);
  console.log(`   Digest: ${parsed.digest}`);

  // 4b. Upload brand logos: English logo goes to header, footer image goes to footer
  let headerHtml = '';
  const logoEnPath = join(articleDir, 'logo-libereal-en.png');
  if (existsSync(logoEnPath)) {
    console.log('   上传品牌Logo（英文，文章顶部）...');
    const enUrl = await uploadContentImage(accessToken, logoEnPath);
    headerHtml = `<div style="text-align:center;margin-bottom:1em;"><img src="${enUrl}" alt="LIBEREAL" style="max-width:260px;margin:0 auto;display:block;" /></div>`;
  }

  let footerHtml = '';
  const footerPath = join(articleDir, 'footer-libereal.png');
  if (existsSync(footerPath)) {
    console.log('   上传页脚品牌图...');
    const footerUrl = await uploadContentImage(accessToken, footerPath);
    footerHtml = `<div style="text-align:center;margin-top:2em;margin-bottom:0.6em;"><img src="${footerUrl}" alt="天放生物" style="max-width:100%;margin:0 auto;display:block;" /></div>`;
  }

  parsed.html = headerHtml + '\n' + parsed.bodyHtml + '\n' + footerHtml + '\n' + parsed.creditsHtml;
  console.log('');

  // 5. Cover image: reuse an existing permanent material, or upload a new one
  let thumbMediaId;
  if (opts.thumbMediaId) {
    console.log('3/5 复用已有封面素材...');
    thumbMediaId = opts.thumbMediaId;
    console.log(`   OK (media_id: ${thumbMediaId})`);
  } else {
    console.log('3/5 上传封面图...');
    const uploadResult = await uploadImage(accessToken, coverPath);
    thumbMediaId = uploadResult.mediaId;
    console.log(`   OK (media_id: ${thumbMediaId})`);
  }

  // 6. Create draft
  console.log('4/5 创建草稿...');
  const draftMediaId = await createDraft(accessToken, {
    title: parsed.title,
    author: opts.author,
    digest: parsed.digest,
    content: parsed.html,
    content_source_url: 'https://libereal.cn',
    thumb_media_id: thumbMediaId,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  });
  console.log(`   OK (draft media_id: ${draftMediaId})`);

  // 7. Optionally publish
  if (opts.publish) {
    console.log('5/5 发布...');
    const publishId = await publishDraft(accessToken, draftMediaId);
    console.log(`   OK (publish_id: ${publishId})`);
  } else {
    console.log('5/5 跳过发布（--publish 可直接发布）');
  }

  console.log('');
  console.log('完成！可在微信公众号后台草稿箱查看。');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
