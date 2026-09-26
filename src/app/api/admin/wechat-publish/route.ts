import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { requireAdmin } from '@/lib/session';
import {
  uploadCoverImage,
  createDraft,
  publishDraft,
  getDraftList,
  deleteDraft,
  parseArticleMarkdown,
} from '@/lib/wechat-publish';

// ---------------------------------------------------------------------------
// POST — Upload article to WeChat draft box (and optionally publish)
// Accepts multipart/form-data:
//   - article: text file (markdown)
//   - cover: image file (png/jpg)
//   - author: string (optional, default "天放生物")
//   - digest: string (optional, auto-extracted)
//   - publish: string "true" | "false" (optional, default "false")
//   - saveCopy: string "true" | "false" (optional, default "true") — save to content/wechat/
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const admin = await requireAdmin('content.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const formData = await request.formData();
    const articleFile = formData.get('article') as File | null;
    const coverFile = formData.get('cover') as File | null;
    const author = (formData.get('author') as string | null) ?? '天放生物';
    const customDigest = formData.get('digest') as string | null;
    const shouldPublish = formData.get('publish') === 'true';
    const saveCopy = formData.get('saveCopy') !== 'false';

    if (!articleFile) {
      return NextResponse.json({ error: '缺少 article 文件' }, { status: 400 });
    }
    if (!coverFile) {
      return NextResponse.json({ error: '缺少 cover 图片' }, { status: 400 });
    }

    // Read article markdown
    const md = await articleFile.text();
    const parsed = parseArticleMarkdown(md);

    if (!parsed.title) {
      return NextResponse.json({ error: '文章缺少标题（# 标题）' }, { status: 400 });
    }

    // Save cover image to temp file for upload
    const coverBuffer = Buffer.from(await coverFile.arrayBuffer());
    const tmpDir = join(process.cwd(), '.tmp');
    await mkdir(tmpDir, { recursive: true });
    const coverExt = coverFile.name.split('.').pop() ?? 'png';
    const tmpCoverPath = join(tmpDir, `wechat-cover-${Date.now()}.${coverExt}`);
    await writeFile(tmpCoverPath, coverBuffer);

    // 1. Upload cover image to WeChat
    const uploadResult = await uploadCoverImage(tmpCoverPath);

    // 2. Create draft
    const draft = await createDraft({
      title: parsed.title,
      content: parsed.html,
      thumbMediaId: uploadResult.mediaId,
      author,
      digest: customDigest || parsed.digest,
      contentSourceUrl: 'https://libereal.cn',
      needOpenComment: 0,
      onlyFansCanComment: 0,
    });

    // 3. Optionally publish
    let publishResult = null;
    if (shouldPublish) {
      publishResult = await publishDraft(draft.mediaId);
    }

    // 4. Optionally save a copy to content/wechat/
    if (saveCopy) {
      const contentDir = join(process.cwd(), 'content', 'wechat');
      await mkdir(contentDir, { recursive: true });
      // Use title to generate filename
      const slug = parsed.title
        .replace(/[：:，,。.!！？?]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40);
      await writeFile(join(contentDir, `${slug}.md`), md);
      await writeFile(join(contentDir, `${slug}-cover.${coverExt}`), coverBuffer);
    }

    return NextResponse.json({
      success: true,
      title: parsed.title,
      digest: customDigest || parsed.digest,
      draftMediaId: draft.mediaId,
      coverUrl: uploadResult.url,
      published: shouldPublish,
      publishId: publishResult?.publishId ?? null,
    });
  } catch (e) {
    console.error('[wechat-publish] error:', e);
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — List drafts from WeChat
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const admin = await requireAdmin('content.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const count = parseInt(searchParams.get('count') ?? '20', 10);

    const drafts = await getDraftList(offset, count);
    return NextResponse.json({ drafts });
  } catch (e) {
    console.error('[wechat-publish] list error:', e);
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Delete a draft
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin('content.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const { mediaId } = await request.json();
    if (!mediaId) {
      return NextResponse.json({ error: '缺少 mediaId' }, { status: 400 });
    }
    await deleteDraft(mediaId);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[wechat-publish] delete error:', e);
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
