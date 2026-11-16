import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminPermissions } from '@/lib/session';
import { listLetterTemplates, saveLetterTemplate, previewLetterTemplate } from '@/lib/business-letters';
import { LetterError } from '@/lib/business-letter-render';

export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof NextResponse) return actor;
  const permissions = await getAdminPermissions(actor);
  if (!permissions.some(key => key === 'inquiries.read' || key === 'content.read')) return NextResponse.json({ error: '没有模板查看权限' }, { status: 403 });
  try {
    return NextResponse.json({ templates: await listLetterTemplates(), canManage: permissions.includes('content.write'), canSend: permissions.includes('inquiries.write'), canReadLetters: permissions.includes('inquiries.read') });
  } catch {
    return NextResponse.json({ error: '模板加载失败，请确认数据库迁移已完成' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin('content.write');
  if (actor instanceof NextResponse) return actor;
  try {
    const raw = await req.text();
    if (raw.length > 20000) throw new LetterError('模板内容过长');
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LetterError('模板格式不正确');
    if (body.action === 'preview') return NextResponse.json({ message: previewLetterTemplate(body) });
    return NextResponse.json({ template: await saveLetterTemplate(body, actor) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof LetterError ? error.message : '模板保存失败，请刷新后重试' }, { status: error instanceof LetterError ? error.status : 400 });
  }
}
