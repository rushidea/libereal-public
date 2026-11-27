import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminPermissions } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { listLetterContacts, previewLetterContact, saveLetterContact } from '@/lib/business-letter-contacts';
import { LetterError } from '@/lib/business-letter-render';

export async function GET(req: NextRequest) {
  const actor = await requireAdmin('inquiries.read');
  if (actor instanceof NextResponse) return actor;
  try {
    const result = await listLetterContacts(req.nextUrl.searchParams.get('q') || '');
    const brands = await prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return NextResponse.json({ ...result, brands, canManage: (await getAdminPermissions(actor)).includes('inquiries.write') });
  } catch (error) {
    return NextResponse.json({ error: error instanceof LetterError ? error.message : '通讯录暂时无法加载，请稍后重试' }, { status: error instanceof LetterError ? error.status : 503 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin('inquiries.write');
  if (actor instanceof NextResponse) return actor;
  try {
    const raw = await req.text();
    if (raw.length > 16000) throw new LetterError('联系人资料过长');
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LetterError('联系人资料格式不正确');
    if (body.action === 'preview') return NextResponse.json({ preview: await previewLetterContact(body) });
    if (body.action === 'save') return NextResponse.json({ contact: await saveLetterContact(body, actor) });
    throw new LetterError('不支持的通讯录操作');
  } catch (error) {
    return NextResponse.json({ error: error instanceof LetterError ? error.message : '保存未完成，请刷新后核对' }, { status: error instanceof LetterError ? error.status : 409 });
  }
}
