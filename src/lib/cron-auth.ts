import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/** 三个 /api/cron/* 共用的请求头。值与去掉首尾空白后的 CRON_SECRET 相同。 */
export const CRON_SECRET_HEADER = 'x-cron-secret';

function readCronSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  return secret.length > 0 ? secret : null;
}

function secretMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  const sameLength = left.length === right.length;
  const compared = timingSafeEqual(left, sameLength ? right : Buffer.alloc(left.length));
  return sameLength && compared;
}

/**
 * 定时任务鉴权。CRON_SECRET 缺失或空白时一律拒绝。
 * 只读取 x-cron-secret，不读取 Authorization，也不读取任何来源 IP 头。
 */
export function isCronRequestAuthorized(req: { headers: { get(name: string): string | null } }): boolean {
  const secret = readCronSecret();
  if (!secret) return false;
  return secretMatches(req.headers.get(CRON_SECRET_HEADER)?.trim() ?? '', secret);
}

export function cronUnauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
