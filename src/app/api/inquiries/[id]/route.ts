import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';
import { inquiryItemView, toInquiryItemCreates } from '@/lib/commerce-records';
import { quoteView } from '@/lib/quote-records';
import { canAccessOrganizationRecord } from '@/lib/organization-record-access';

interface LogItem {
  name: string;
  price: number;
  quantity: number;
  leadTime?: string;
}

interface LogEntry {
  adminId: string;
  adminEmail: string;
  time: string;
  items: LogItem[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  if (user.role === 'admin') {
    const admin = await requireAdmin('inquiries.read');
    if (admin instanceof NextResponse) return admin;
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: {
      inquiryItems: { orderBy: { position: 'asc' } },
      quotes: { orderBy: { version: 'desc' }, take: 1, include: { items: { orderBy: { position: 'asc' } } } },
    },
  });
  if (!inquiry) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
  if (user.role !== 'admin') {
    const allowed = inquiry.ownerScope === 'organization'
      ? Boolean(inquiry.organizationId) && await canAccessOrganizationRecord(user.id, inquiry.organizationId as string)
      : inquiry.email === user.email;
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { inquiryItems, quotes, ...rest } = inquiry;
  return NextResponse.json({
    ...rest,
    items: inquiryItems.map(inquiryItemView),
    activeQuote: quotes[0] ? quoteView(quotes[0]) : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAdmin('inquiries.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();

    const inquiry = await prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    const updateData: Prisma.InquiryUpdateInput = {};

    if (body.status) updateData.status = body.status;
    if (body.address !== undefined) updateData.address = body.address;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.paymentMethod !== undefined) updateData.paymentMethod = body.paymentMethod;

    if (body.items !== undefined) {
      const itemsArray = body.items;
      if (!Array.isArray(itemsArray)) {
        return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
      }
      updateData.inquiryItems = {
        deleteMany: {},
        create: toInquiryItemCreates(itemsArray as Array<Record<string, unknown>>),
      };

      // Append operation log entry
      const logEntry: LogEntry = {
        adminId: user.id,
        adminEmail: user.email,
        time: new Date().toISOString(),
        items: (itemsArray as Array<Record<string, unknown>>).map((i) => ({
          name: (i.name as string) || ((i.product as Record<string, unknown>)?.name as string) || '',
          price: (i.price as number) ?? 0,
          quantity: (i.quantity as number) ?? 1,
          leadTime: (i.actualLeadTime as string) || (i.leadTime as string) || '',
        })),
      };
      const existingLogs: LogEntry[] = inquiry.operationLogs ? JSON.parse(inquiry.operationLogs) : [];
      existingLogs.push(logEntry);
      updateData.operationLogs = JSON.stringify(existingLogs);
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.inquiry.update({ where: { id }, data: updateData });
    }

    // Status-change notification
    if (body.status && body.status !== inquiry.status) {
      const notifTitle = '询价单状态更新';
      let notifContent = `您的询价单状态已更新为：${body.status}`;
      const notifLink = `/account/inquiries?id=${id}`;

      if (body.status === '已确认') {
        notifContent = '您的询价单已确认，我们会尽快处理您的订单。';
      } else if (body.status === '已拒绝') {
        notifContent = '您的询价单未通过，请联系客服了解详情。';
      } else if (body.status === '处理中') {
        notifContent = '您的询价单正在处理中，我们会尽快与您联系。';
      }

      await prisma.notification.create({
        data: {
          email: inquiry.email,
          role: 'customer',
          type: 'inquiry_status_updated',
          title: notifTitle,
          content: notifContent,
          linkUrl: notifLink,
        },
      });
    }

    // Lead-time update notification
    if (body.items !== undefined) {
      const items = body.items as Array<Record<string, unknown>>;
      const hasActualLeadTime = items.some((i) => i.actualLeadTime);
      if (hasActualLeadTime) {
        await prisma.notification.create({
          data: {
            email: inquiry.email,
            role: 'customer',
            type: 'inquiry_leadtime_updated',
            title: '货期已更新',
            content: `您的询价单 ${id} 的产品实际货期已更新，请注意查看。`,
            linkUrl: `/account/inquiries/${id}`,
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[inquiry PATCH] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
