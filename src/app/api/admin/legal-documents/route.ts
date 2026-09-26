import { NextRequest, NextResponse } from 'next/server';
import { listAllLegalDocumentsAdmin, updateLegalDocument } from '@/lib/legal-documents';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  const session = await requireAdmin('content.read');
  if (session instanceof NextResponse) return session;

  try {
    const documents = await listAllLegalDocumentsAdmin();
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('[admin/legal-documents] failed to list documents', error);
    return NextResponse.json(
      { error: '文书数据加载失败，请确认数据库迁移已执行并重试。' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin('content.write');
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式不正确' }, { status: 400 });
  }
  const { id, ...patch } = body as {
    id?: string;
    published?: boolean;
    requireRegister?: boolean;
    requireCheckout?: boolean;
    showOnLegalPage?: boolean;
    showOnOpenPlatform?: boolean;
    sortOrder?: number;
    description?: string | null;
  };

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: '缺少文书 id' }, { status: 400 });
  }

  const allowed: Record<string, unknown> = {};
  if (typeof patch.published === 'boolean') allowed.published = patch.published;
  if (typeof patch.requireRegister === 'boolean') allowed.requireRegister = patch.requireRegister;
  if (typeof patch.requireCheckout === 'boolean') allowed.requireCheckout = patch.requireCheckout;
  if (typeof patch.showOnLegalPage === 'boolean') allowed.showOnLegalPage = patch.showOnLegalPage;
  if (typeof patch.showOnOpenPlatform === 'boolean') allowed.showOnOpenPlatform = patch.showOnOpenPlatform;
  if (typeof patch.sortOrder === 'number' && Number.isFinite(patch.sortOrder)) allowed.sortOrder = patch.sortOrder;
  if (patch.description === null || typeof patch.description === 'string') allowed.description = patch.description;

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: '无有效更新字段' }, { status: 400 });
  }

  try {
    const updated = await updateLegalDocument(id, allowed);
    return NextResponse.json({ document: updated });
  } catch (error) {
    console.error('[admin/legal-documents] failed to update document', error);
    return NextResponse.json({ error: '文书保存失败，请确认数据库迁移已执行并重试。' }, { status: 500 });
  }
}
