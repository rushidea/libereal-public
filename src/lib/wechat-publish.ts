import { readFile } from 'node:fs/promises';
import { getWechatAccessToken, getWechatOfficialAccountConfig } from '@/lib/wechat-jssdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WechatArticle {
  title: string;
  content: string; // HTML
  thumbMediaId: string;
  author?: string;
  digest?: string;
  contentSourceUrl?: string;
  needOpenComment?: 0 | 1;
  onlyFansCanComment?: 0 | 1;
}

export interface UploadImageResult {
  mediaId: string;
  url: string;
}

export interface CreateDraftResult {
  mediaId: string; // draft media_id
}

export interface PublishResult {
  publishId: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const WECHAT_API_BASE = 'https://api.weixin.qq.com/cgi-bin';

async function wechatPost(path: string, body: unknown, searchParams?: Record<string, string>): Promise<unknown> {
  const accessToken = await getWechatAccessToken();
  const url = new URL(`${WECHAT_API_BASE}${path}`);
  url.searchParams.set('access_token', accessToken);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`WECHAT_API_ERROR:${data.errcode}:${data.errmsg ?? 'unknown'}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Upload cover image as permanent material (material/add_material?type=image)
// Returns { media_id, url } — media_id is used as thumb_media_id in draft
// ---------------------------------------------------------------------------

export async function uploadCoverImage(imagePath: string): Promise<UploadImageResult> {
  const accessToken = await getWechatAccessToken();
  const buffer = await readFile(imagePath);
  const filename = imagePath.split('/').pop() ?? 'cover.png';

  const url = new URL(`${WECHAT_API_BASE}/material/add_material`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('type', 'image');

  const formData = new FormData();
  formData.append('media', new Blob([buffer]), filename);

  const res = await fetch(url, { method: 'POST', body: formData, cache: 'no-store' });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`WECHAT_UPLOAD_MATERIAL_ERROR:${data.errcode}:${data.errmsg ?? 'unknown'}`);
  }
  return { mediaId: data.media_id, url: data.url ?? '' };
}

// ---------------------------------------------------------------------------
// Upload image for use inside article content (media/uploadimg, same endpoint)
// Returns the URL to embed in HTML
// ---------------------------------------------------------------------------

export async function uploadContentImage(imagePath: string): Promise<string> {
  const result = await uploadCoverImage(imagePath);
  return result.url;
}

// ---------------------------------------------------------------------------
// Create draft (draft/add)
// ---------------------------------------------------------------------------

export async function createDraft(article: WechatArticle): Promise<CreateDraftResult> {
  const data = await wechatPost('/draft/add', {
    articles: [
      {
        title: article.title,
        author: article.author ?? '天放生物',
        digest: article.digest ?? '',
        content: article.content,
        content_source_url: article.contentSourceUrl ?? '',
        thumb_media_id: article.thumbMediaId,
        need_open_comment: article.needOpenComment ?? 0,
        only_fans_can_comment: article.onlyFansCanComment ?? 0,
      },
    ],
  });
  return { mediaId: (data as { media_id: string }).media_id };
}

// ---------------------------------------------------------------------------
// Publish draft (freepublish/submit)
// ---------------------------------------------------------------------------

export async function publishDraft(mediaId: string): Promise<PublishResult> {
  const data = await wechatPost('/freepublish/submit', { media_id: mediaId });
  return { publishId: (data as { publish_id: string }).publish_id };
}

// ---------------------------------------------------------------------------
// Get draft list (draft/batchget)
// ---------------------------------------------------------------------------

export async function getDraftList(offset = 0, count = 20): Promise<unknown> {
  return wechatPost('/draft/batchget', { offset, count, no_content: 1 });
}

// ---------------------------------------------------------------------------
// Delete draft (draft/delete)
// ---------------------------------------------------------------------------

export async function deleteDraft(mediaId: string): Promise<void> {
  await wechatPost('/draft/delete', { media_id: mediaId });
}

// ---------------------------------------------------------------------------
// Markdown → WeChat HTML converter
// WeChat strips external CSS, so all styles must be inline.
// ---------------------------------------------------------------------------

const STYLE_P = 'margin:0 0 1em;padding:0;font-size:16px;line-height:1.8;color:#3f3f3f;letter-spacing:0.5px;';
const STYLE_H2 = 'margin:1.8em 0 0.6em;padding:0;font-size:19px;font-weight:bold;color:#1a1a1a;border-bottom:1px solid #e8e8e8;padding-bottom:6px;';
const STYLE_H3 = 'margin:1.4em 0 0.5em;padding:0;font-size:17px;font-weight:bold;color:#1a1a1a;';
const STYLE_STRONG = 'color:#1a1a1a;';
const STYLE_BLOCKQUOTE = 'margin:1em 0;padding:10px 14px;background:#f7f7f7;border-left:3px solid #ccc;font-size:15px;color:#888;line-height:1.7;';
const STYLE_HR = 'border:none;border-top:1px solid #e0e0e0;margin:2em 0;';
const STYLE_UL = 'margin:0 0 1em;padding-left:1.4em;font-size:16px;line-height:1.8;color:#3f3f3f;';
const STYLE_LI = 'margin-bottom:0.4em;';
const STYLE_A = 'color:#576b95;text-decoration:none;';
const STYLE_FOOTER = 'margin-top:2em;padding:14px;background:#f7f7f7;border-radius:6px;font-size:14px;color:#888;line-height:1.6;text-align:center;';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function processInline(text: string): string {
  let result = escapeHtml(text);
  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, `<strong style="${STYLE_STRONG}">$1</strong>`);
  // Italic: *text* (but not ** which is bold)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Inline code: `text`
  result = result.replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:14px;">$1</code>');
  // Links: [text](url)
  result = result.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="${STYLE_A}">$1</a>`);
  return result;
}

export function markdownToWechatHtml(md: string): string {
  const lines = md.split('\n');
  const htmlParts: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  let inBlockquote = false;
  let blockquoteLines: string[] = [];
  let inFooter = false;
  let footerLines: string[] = [];

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

    // Skip the first H1 (it's the title, handled separately)
    if (i === 0 && trimmed.startsWith('# ')) continue;

    // Skip metadata blockquote (> 主题：...) — we'll skip the first blockquote
    // Actually, let's handle all blockquotes uniformly

    // Horizontal rule
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      closeList();
      closeBlockquote();
      closeFooter();
      htmlParts.push(`<hr style="${STYLE_HR}"/>`);
      continue;
    }

    // Heading 2
    if (trimmed.startsWith('## ')) {
      closeList();
      closeBlockquote();
      closeFooter();
      htmlParts.push(`<h2 style="${STYLE_H2}">${processInline(trimmed.slice(3))}</h2>`);
      continue;
    }

    // Heading 3
    if (trimmed.startsWith('### ')) {
      closeList();
      closeBlockquote();
      closeFooter();
      htmlParts.push(`<h3 style="${STYLE_H3}">${processInline(trimmed.slice(4))}</h3>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      closeList();
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteLines = [];
      }
      blockquoteLines.push(trimmed.slice(2));
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      closeBlockquote();
      closeFooter();
      if (!inList || listType !== 'ul') {
        closeList();
        inList = true;
        listType = 'ul';
        htmlParts.push(`<ul style="${STYLE_UL}">`);
      }
      htmlParts.push(`<li style="${STYLE_LI}">${processInline(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      closeBlockquote();
      closeFooter();
      if (!inList || listType !== 'ol') {
        closeList();
        inList = true;
        listType = 'ol';
        htmlParts.push(`<ol style="${STYLE_UL}">`);
      }
      htmlParts.push(`<li style="${STYLE_LI}">${processInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    // Empty line
    if (trimmed === '') {
      closeList();
      closeBlockquote();
      // Don't close footer on empty lines
      continue;
    }

    // Detect footer section (after the last ---)
    // If we've seen a --- and the remaining content looks like branding
    if (trimmed.includes('libereal.cn') || trimmed.includes('天放生物')) {
      closeList();
      closeBlockquote();
      if (!inFooter) {
        inFooter = true;
        footerLines = [];
      }
      footerLines.push(trimmed);
      continue;
    }

    // Regular paragraph
    closeList();
    closeBlockquote();
    closeFooter();
    htmlParts.push(`<p style="${STYLE_P}">${processInline(trimmed)}</p>`);
  }

  closeList();
  closeBlockquote();
  closeFooter();

  return htmlParts.join('\n');
}

// ---------------------------------------------------------------------------
// Parse article markdown file
// ---------------------------------------------------------------------------

export interface ParsedArticle {
  title: string;
  digest: string;
  contentMd: string; // markdown body (without title and metadata)
  html: string; // converted HTML
}

export function parseArticleMarkdown(md: string): ParsedArticle {
  const lines = md.split('\n');

  // Extract title from first # heading
  let title = '';
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('# ')) {
      title = trimmed.slice(2).trim();
      startIdx = i + 1;
      break;
    }
  }

  // Extract digest from metadata blockquote (> 主题：... | 关联：... | 字数：...)
  let digest = '';
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('> ')) {
      const meta = trimmed.slice(2);
      // Try to extract a useful digest from the metadata
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
    // If no blockquote found, use first paragraph as digest
    if (!digest && trimmed && !trimmed.startsWith('#')) {
      digest = trimmed.slice(0, 54);
      break;
    }
  }

  // Reconstruct body markdown (from after metadata to end)
  const bodyMd = lines.slice(startIdx).join('\n').trim();
  const html = markdownToWechatHtml(lines.slice(startIdx).join('\n'));

  return { title, digest: digest || title, contentMd: bodyMd, html };
}
