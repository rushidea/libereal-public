import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { listLetterDrafts, prepareBusinessLetter, approveBusinessLetter, dispatchApprovedBusinessLetter } from '@/lib/business-letters';
import { LetterError, boundedText } from '@/lib/business-letter-render';

export async function GET() {
  const actor = await requireAdmin('inquiries.read');
  if (actor instanceof NextResponse) return actor;
  try { return NextResponse.json({ letters: await listLetterDrafts() }); }
  catch { return NextResponse.json({ error: '信函记录加载失败，请稍后重试' }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin('inquiries.write');
  if (actor instanceof NextResponse) return actor;
  try {
    const raw = await req.text();
    if (raw.length > 40000) throw new LetterError('信函内容过长');
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LetterError('请求格式不正确');
    if (body.action === 'preview') {
      const letter = await prepareBusinessLetter({ templateId: body.templateId, templateRevision: body.templateRevision,
        to: body.to, fields: body.fields, businessReference: body.businessReference, reviewId: body.reviewId }, actor);
      return NextResponse.json({ letter });
    }
    if (body.action === 'send') {
      const id = boundedText(body.id, '信函编号', 100);
      const hash = boundedText(body.approvalHash, '预览确认', 64);
      if (!/^[a-f0-9]{64}$/.test(hash) || body.confirm !== true) throw new LetterError('请先确认完整预览与收件人');
      await approveBusinessLetter(id, hash, actor);
      return NextResponse.json({ letter: await dispatchApprovedBusinessLetter(id) });
    }
    throw new LetterError('不支持的信函操作');
  } catch (error) {
    return NextResponse.json({ error: error instanceof LetterError ? error.message : '信函操作未完成，请刷新记录核对，勿重复发送' }, { status: error instanceof LetterError ? error.status : 409 });
  }
}
