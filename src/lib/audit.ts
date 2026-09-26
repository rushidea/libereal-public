import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type AuditClient = Prisma.TransactionClient | typeof prisma;

export type AuditEntry = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resource: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: unknown;
};

function serialize(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export async function writeAuditLog(entry: AuditEntry, client: AuditClient = prisma) {
  return client.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      resource: entry.resource,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      beforeData: serialize(entry.before),
      afterData: serialize(entry.after),
      reason: entry.reason?.trim() || null,
      metadata: serialize(entry.metadata),
    },
  });
}
