import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { requireAdmin } from '@/lib/session';
import {
  WechatPublishPathError,
  buildWechatPublishPaths,
} from '@/lib/wechat-publish-paths';
import {
  uploadCoverImage,
  createDraft,
  publishDraft,
  getDraftList,
  deleteDraft,
  parseArticleMarkdown,
} from '@/lib/wechat-publish';


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

    const md = await articleFile.text();
    const parsed = parseArticleMarkdown(md);

    if (!parsed.title) {
      return NextResponse.json({ error: '文章缺少标题（# 标题）' }, { status: 400 });
    }

    const contentDir = join(process.cwd(), 'content', 'wechat');
    const tmpDir = join(process.cwd(), '.tmp');
    let publishPaths;
    try {
      publishPaths = buildWechatPublishPaths({
        title: parsed.title,
        coverFilename: typeof coverFile.name === 'string' ? coverFile.name : '',
        contentDir,
        tempDir: tmpDir,
      });
    } catch (error) {
      if (error instanceof WechatPublishPathError) {
        return NextResponse.json({ error: '文件路径无效' }, { status: 400 });
      }
      throw error;
    }
    if (!publishPaths.ok) {
      return NextResponse.json({ error: '封面只支持 png、jpg、jpeg 或 webp 图片' }, { status: 400 });
    }

    const coverBuffer = Buffer.from(await coverFile.arrayBuffer());
    await mkdir(tmpDir, { recursive: true });
    await writeFile(publishPaths.tempCoverPath, coverBuffer);

    const uploadResult = await uploadCoverImage(publishPaths.tempCoverPath);

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
      await mkdir(contentDir, { recursive: true });
      await writeFile(publishPaths.articlePath, md);
      await writeFile(publishPaths.coverCopyPath, coverBuffer);
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
