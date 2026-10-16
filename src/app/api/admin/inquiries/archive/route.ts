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

    if (action === 'archive' || action === 'delete') {
      // 后台「删除」只归档。硬删除会级联拆掉报价和明细；已转订单的询价会丢掉关联，外键收紧时还会失败。
      await prisma.inquiry.updateMany({
        where: { id: { in: inquiryIds } },
        data: { archivedAt: now },
      });
    } else if (action === 'unarchive') {
      await prisma.inquiry.updateMany({
        where: { id: { in: inquiryIds } },
        data: { archivedAt: null },
      });
    } else {
      return NextResponse.json({ error: "无效操作" }, { status: 400 });
    }

    return NextResponse.json({ success: true, count: inquiryIds.length });
  } catch (err) {
    console.error("[admin/inquiries/archive PATCH]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
