import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getRequestIp } from './mfa-rate-limit';
import { MFA_RECENT_WINDOW_MS } from './mfa-config';

const MAX_USER_AGENT_LENGTH = 512;
const MAX_DEVICE_NAME_LENGTH = 80;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_SESSION_LIST_SIZE = 100;

export interface SecurityRequestMetadata {
  ip: string | null;
  userAgent: string | null;
  browser: string | null;
  operatingSystem: string | null;
  fingerprint: string;
}

export interface SecuritySessionSummary {
  id: string;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date | null;
  current: boolean;
  device: {
    id: string;
    name: string | null;
    browser: string | null;
    operatingSystem: string | null;
    ip: string | null;
    lastSeenAt: Date;
    createdAt: Date;
  } | null;
}

export interface SecurityDeviceSummary {
  id: string;
  name: string | null;
  browser: string | null;
  operatingSystem: string | null;
  ip: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  sessionCount: number;
}

export interface SecurityEventSummary {
  id: string;
  eventType: string;
  ip: string | null;
  device: string | null;
  userAgent: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
}

function trimText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function parseUserAgent(userAgent: string | null): { browser: string | null; operatingSystem: string | null } {
  const value = userAgent?.trim() ?? '';
  if (!value) return { browser: null, operatingSystem: null };

  const browser = /Edg\//i.test(value)
    ? 'Edge'
    : /Chrome\//i.test(value) && !/Chromium\//i.test(value)
      ? 'Chrome'
      : /Firefox\//i.test(value)
        ? 'Firefox'
        : /Safari\//i.test(value) && !/Chrome\//i.test(value)
          ? 'Safari'
          : /OPR\//i.test(value)
            ? 'Opera'
            : null;

  const operatingSystem = /Windows/i.test(value)
    ? 'Windows'
    : /Android/i.test(value)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(value)
        ? 'iOS'
        : /Mac OS X/i.test(value)
          ? 'macOS'
          : /Linux/i.test(value)
            ? 'Linux'
            : null;

  return { browser, operatingSystem };
}

export function buildDeviceFingerprint(userId: string, userAgent: string | null, ip?: string | null): string {
  void ip;
  return createHash('sha256')
    .update(`${userId}\n${userAgent ?? ''}`)
    .digest('hex');
}

export function createSecurityRequestMetadata(input: {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
}): SecurityRequestMetadata {
  const userAgent = trimText(input.userAgent, MAX_USER_AGENT_LENGTH);
  const ip = trimText(input.ip, 128);
  const parsed = parseUserAgent(userAgent);
  return {
    ip,
    userAgent,
    browser: parsed.browser,
    operatingSystem: parsed.operatingSystem,
    fingerprint: buildDeviceFingerprint(input.userId, userAgent, ip),
  };
}

export async function getSecurityRequestMetadata(userId: string): Promise<SecurityRequestMetadata> {
  let userAgent: string | null = null;
  try {
    const requestHeaders = await headers();
    userAgent = requestHeaders.get('user-agent');
  } catch {
    userAgent = null;
  }
  return createSecurityRequestMetadata({ userId, userAgent, ip: await getRequestIp() });
}

export async function registerSecuritySession(input: {
  userId: string;
  sessionId: string;
  expiresAt?: Date | null;
  metadata?: SecurityRequestMetadata;
}): Promise<void> {
  const metadata = input.metadata ?? await getSecurityRequestMetadata(input.userId);
  const now = new Date();
  const existingDevice = await prisma.userDevice.findFirst({
    where: { userId: input.userId, fingerprint: metadata.fingerprint, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
  });
  const device = existingDevice
    ? await prisma.userDevice.update({
        where: { id: existingDevice.id },
        data: {
          browser: metadata.browser,
          operatingSystem: metadata.operatingSystem,
          ip: metadata.ip,
          lastSeenAt: now,
        },
      })
    : await prisma.userDevice.create({
        data: {
          userId: input.userId,
          fingerprint: metadata.fingerprint,
          browser: metadata.browser,
          operatingSystem: metadata.operatingSystem,
          ip: metadata.ip,
          lastSeenAt: now,
        },
      });

  await prisma.userSession.upsert({
    where: { sessionId: input.sessionId },
    create: {
      userId: input.userId,
      sessionId: input.sessionId,
      deviceId: device.id,
      ip: metadata.ip,
      userAgent: metadata.userAgent,
      lastSeenAt: now,
      expiresAt: input.expiresAt ?? null,
    },
    update: {
      deviceId: device.id,
      ip: metadata.ip,
      userAgent: metadata.userAgent,
      lastSeenAt: now,
      expiresAt: input.expiresAt ?? undefined,
    },
  });
}

export async function touchSecuritySession(userId: string, sessionId: string): Promise<boolean> {
  const current = await prisma.userSession.findFirst({
    where: { userId, sessionId, revokedAt: null },
    select: { id: true, deviceId: true, lastSeenAt: true },
  });
  if (!current) return false;

  const now = new Date();
  if (now.getTime() - current.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) return true;

  await prisma.$transaction([
    prisma.userSession.update({ where: { id: current.id }, data: { lastSeenAt: now } }),
    ...(current.deviceId
      ? [prisma.userDevice.update({ where: { id: current.deviceId }, data: { lastSeenAt: now } })]
      : []),
  ]);
  return true;
}

export async function isSecuritySessionActive(userId: string, sessionId: string): Promise<boolean> {
  const row = await prisma.userSession.findFirst({
    where: {
      userId,
      sessionId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function markSecuritySessionMfaVerified(userId: string, sessionId: string, verifiedAt = new Date()): Promise<boolean> {
  const result = await prisma.userSession.updateMany({
    where: {
      userId,
      sessionId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: verifiedAt } }],
    },
    data: { lastMfaAt: verifiedAt },
  });
  return result.count === 1;
}

export async function hasRecentSecuritySessionMfa(userId: string, sessionId: string, now = new Date()): Promise<boolean> {
  const row = await prisma.userSession.findFirst({
    where: {
      userId,
      sessionId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { lastMfaAt: true },
  });
  return Boolean(row?.lastMfaAt && now.getTime() - row.lastMfaAt.getTime() <= MFA_RECENT_WINDOW_MS);
}

export async function getSecuritySessionState(userId: string, sessionId: string): Promise<{ known: boolean; active: boolean }> {
  const row = await prisma.userSession.findFirst({
    where: { userId, sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!row) return { known: false, active: false };
  return {
    known: true,
    active: !row.revokedAt && (!row.expiresAt || row.expiresAt > new Date()),
  };
}

export type SecuritySessionState = 'missing' | 'active' | 'revoked' | 'expired';

export async function getSecuritySessionStateDetailed(userId: string, sessionId: string): Promise<SecuritySessionState> {
  const row = await prisma.userSession.findFirst({
    where: { userId, sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!row) return 'missing';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt <= new Date()) return 'expired';
  return 'active';
}

export async function listSecuritySessions(userId: string, currentSessionId?: string | null): Promise<SecuritySessionSummary[]> {
  const rows = await prisma.userSession.findMany({
    where: {
      userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { device: true },
    orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    take: MAX_SESSION_LIST_SIZE,
  });

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    current: row.sessionId === currentSessionId,
    device: row.device
      ? {
          id: row.device.id,
          name: row.device.name,
          browser: row.device.browser,
          operatingSystem: row.device.operatingSystem,
          ip: row.device.ip,
          lastSeenAt: row.device.lastSeenAt,
          createdAt: row.device.createdAt,
        }
      : null,
  }));
}

export async function listSecurityDevices(userId: string): Promise<SecurityDeviceSummary[]> {
  const rows = await prisma.userDevice.findMany({
    where: { userId, revokedAt: null },
    include: { _count: { select: { sessions: { where: { revokedAt: null } } } } },
    orderBy: { lastSeenAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    browser: row.browser,
    operatingSystem: row.operatingSystem,
    ip: row.ip,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    sessionCount: row._count.sessions,
  }));
}

export async function revokeSecuritySession(userId: string, sessionId: string): Promise<boolean> {
  const result = await prisma.userSession.updateMany({
    where: { userId, sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

export async function revokeSecuritySessionById(userId: string, id: string): Promise<boolean> {
  const result = await prisma.userSession.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

export async function revokeOtherSecuritySessions(userId: string, currentSessionId: string): Promise<number> {
  const result = await prisma.userSession.updateMany({
    where: { userId, sessionId: { not: currentSessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeAllSecuritySessions(userId: string): Promise<number> {
  const result = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function renameSecurityDevice(userId: string, deviceId: string, name: string): Promise<boolean> {
  const normalizedName = trimText(name, MAX_DEVICE_NAME_LENGTH);
  if (!normalizedName) return false;
  const result = await prisma.userDevice.updateMany({
    where: { id: deviceId, userId, revokedAt: null },
    data: { name: normalizedName },
  });
  return result.count === 1;
}

export async function revokeSecurityDevice(userId: string, deviceId: string, currentSessionId?: string | null): Promise<{ revoked: boolean; current: boolean }> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const device = await tx.userDevice.findFirst({ where: { id: deviceId, userId, revokedAt: null }, select: { id: true } });
    if (!device) return { revoked: false, current: false };
    const current = currentSessionId
      ? Boolean(await tx.userSession.findFirst({ where: { userId, sessionId: currentSessionId, deviceId: device.id, revokedAt: null }, select: { id: true } }))
      : false;
    await tx.userDevice.update({ where: { id: device.id }, data: { revokedAt: now } });
    await tx.userSession.updateMany({ where: { userId, deviceId: device.id, revokedAt: null }, data: { revokedAt: now } });
    return { revoked: true, current };
  });
}

export async function listSecurityEvents(userId: string, limit = 50): Promise<SecurityEventSummary[]> {
  const rows = await prisma.securityEvent.findMany({
    where: { userId },
    select: { id: true, eventType: true, ip: true, userAgent: true, metadata: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Math.floor(limit), 1), 100),
  });

  return rows.map((row) => {
    let metadata: Record<string, string> = {};
    if (row.metadata) {
      try {
        const parsed = JSON.parse(row.metadata) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          metadata = Object.fromEntries(
            Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
          );
        }
      } catch {
        metadata = {};
      }
    }
    const parsedDevice = parseUserAgent(row.userAgent);
    const device = [parsedDevice.browser, parsedDevice.operatingSystem].filter(Boolean).join(' · ') || null;
    return { ...row, device, metadata };
  });
}
