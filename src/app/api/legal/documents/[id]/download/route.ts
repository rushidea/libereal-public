import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { resolveLegalPdfAbsolutePath } from '@/lib/legal-documents';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const resolved = await resolveLegalPdfAbsolutePath(id);
  if (!resolved) {
    return NextResponse.json({ error: '文书不存在或不可下载' }, { status: 404 });
  }

  const buffer = fs.readFileSync(resolved.filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(resolved.fileName)}`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
