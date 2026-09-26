import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin('inquiries.write');
  if (session instanceof NextResponse) return session;

  try {
    const { inquiryIds, action } = await req.json();

    if (!inquiryIds || !Array.isArray(inquiryIds) || inquiryIds.length === 0) {
      return NextResponse.json({ error: "缺少inquiryIds" }, { status: 400 });
    }

    const now = new Date();

    if (action === 'archive') {
      await prisma.inquiry.updateMany({
        where: { id: { in: inquiryIds } },
        data: { archivedAt: now },
      });
    } else if (action === 'unarchive') {
      await prisma.inquiry.updateMany({
        where: { id: { in: inquiryIds } },
        data: { archivedAt: null },
      });
    } else if (action === 'delete') {
      await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
    } else {
      return NextResponse.json({ error: "无效操作" }, { status: 400 });
    }

    return NextResponse.json({ success: true, count: inquiryIds.length });
  } catch (err) {
    console.error("[admin/inquiries/archive PATCH]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
