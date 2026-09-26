import { NextResponse } from 'next/server';
import { getAlipaySdk } from '@/lib/alipay';
import { prisma } from '@/lib/prisma';

const MAX_MESSAGE_SIZE = 256 * 1024;

function textResponse(body: 'success' | 'fail', status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function messagePayload(data: Record<string, string>) {
  const { sign: _sign, sign_type: _signType, ...payload } = data;
  return JSON.stringify(payload);
}

export async function POST(req: Request) {
  const client = getAlipaySdk();
  if (!client) return textResponse('fail', 503);

  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_MESSAGE_SIZE) return textResponse('fail', 413);

  const rawBody = await req.text();
  if (!rawBody || rawBody.length > MAX_MESSAGE_SIZE) return textResponse('fail', 400);

  const data = Object.fromEntries(new URLSearchParams(rawBody).entries());
  if (!client.sdk.checkNotifySign(data)) return textResponse('fail', 400);

  const notifyId = data.notify_id?.trim();
  const msgMethod = (data.msg_method || data.notify_type)?.trim();
  if (!notifyId || !msgMethod || data.app_id !== client.config.appId) {
    return textResponse('fail', 400);
  }

  const existing = await prisma.alipayMessageReceipt.findUnique({
    where: { notifyId },
    select: { id: true },
  });
  if (existing) return textResponse('success');

  try {
    await prisma.alipayMessageReceipt.create({
      data: {
        notifyId,
        msgMethod,
        notifyType: data.notify_type || null,
        appId: data.app_id,
        payload: messagePayload(data),
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return textResponse('success');
    throw error;
  }

  return textResponse('success');
}
