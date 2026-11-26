import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { isUniqueConstraintError } from '@/lib/checkout-idempotency';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { prisma } from '@/lib/prisma';
import type { HarnessLeaseHeader, HarnessPrincipal } from './auth';
import { computeInquiryVersion, HarnessServiceError } from './inquiry-tools-service';

type Db = Prisma.TransactionClient | typeof prisma;

export const HARNESS_INQUIRY_LEASE_TASK_TYPE = 'aiops.harness.inquiry_lease';
const DEFAULT_LEASE_DURATION_MS = 120_000;
const MIN_LEASE_DURATION_MS = 500;
const MAX_LEASE_DURATION_MS = 900_000;
const OWNER_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export function leaseDedupeKey(environment: string, inquiryId: string): string {
  return `harness-lease:${environment}:inquiry:${inquiryId}`;
}

export interface ClaimInquiryLeaseInput {
  ownerId: string;
  threadId: string;
  leaseDurationMs?: number;
}

export interface ReleaseInquiryLeaseInput {
  leaseToken: string;
  fenceToken: number;
  action: 'complete' | 'cancel';
  reason?: string;
}

export interface InquiryLeaseSummary {
  taskId: string;
  status: string;
  ownerId: string | null;
  threadId: string | null;
  fenceToken: number;
  leaseExpiresAt: string | null;
  expired: boolean;
}

function parseExpiresAtMs(payload: Record<string, unknown>): number | null {
  if (typeof payload.leaseExpiresAt !== 'string') return null;
  const parsed = Date.parse(payload.leaseExpiresAt);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function claimInquiryLeaseForHarness(
  inquiryId: string,
  input: ClaimInquiryLeaseInput,
  principal: HarnessPrincipal,
) {
  const ownerId = typeof input.ownerId === 'string' ? input.ownerId.trim() : '';
  if (!OWNER_ID_RE.test(ownerId)) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_OWNER_ID', 'ownerId 格式无效');
  }
  const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : '';
  if (!threadId || threadId.length > 160) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_THREAD_ID', 'threadId 格式无效');
  }
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  if (
    typeof leaseDurationMs !== 'number' ||
    !Number.isInteger(leaseDurationMs) ||
    leaseDurationMs < MIN_LEASE_DURATION_MS ||
    leaseDurationMs > MAX_LEASE_DURATION_MS
  ) {
    throw new HarnessServiceError(
      400,
      'validation_error',
      'INVALID_LEASE_DURATION',
      `leaseDurationMs 必须为 ${MIN_LEASE_DURATION_MS}~${MAX_LEASE_DURATION_MS} 的整数毫秒`,
    );
  }

  const dedupeKey = leaseDedupeKey(principal.environment, inquiryId);

  try {
    return await prisma.$transaction(async (tx) => {
      const inquiry = await tx.inquiry.findUnique({
        where: { id: inquiryId },
        select: { id: true },
      });
      if (!inquiry) {
        throw new HarnessServiceError(404, 'not_found', 'INQUIRY_NOT_FOUND', '未找到指定询价单');
      }

      const now = new Date();
      const nowMs = now.getTime();
      const expiresAt = new Date(nowMs + leaseDurationMs);
      const leaseToken = randomUUID();
      const nextLockedBy = `${principal.clientId}:${ownerId}:${leaseToken}`;

      const existing = await tx.backgroundTask.findUnique({ where: { dedupeKey } });

      let taskId: string;
      let fenceToken: number;
      let reclaimedExpiredLease = false;

      if (!existing) {
        fenceToken = 1;
        const created = await tx.backgroundTask.create({
          data: {
            type: HARNESS_INQUIRY_LEASE_TASK_TYPE,
            status: 'running',
            attempts: fenceToken,
            maxAttempts: 1,
            lockedAt: now,
            lockedBy: nextLockedBy,
            dedupeKey,
            payload: JSON.stringify({
              inquiryId,
              environment: principal.environment,
              engine: 'deepagents-ts-harness',
              clientId: principal.clientId,
              ownerId,
              threadId,
              leaseToken,
              fenceToken,
              leaseDurationMs,
              leaseExpiresAt: expiresAt.toISOString(),
            }),
          },
        });
        taskId = created.id;

        await writeAuditLog(
          {
            actorId: `harness:${principal.clientId}`,
            actorEmail: `${principal.clientId}@harness.local`,
            action: 'harness.lease.claimed',
            resource: 'inquiries',
            targetType: 'Inquiry',
            targetId: inquiryId,
            after: {
              taskId,
              ownerId,
              threadId,
              fenceToken,
              leaseExpiresAt: expiresAt.toISOString(),
            },
            reason: 'Harness 获取单询价执行租约',
          },
          tx,
        );
      } else {
        const existingPayload = jsonObject(existing.payload);
        const existingExpiresMs = parseExpiresAtMs(existingPayload);
        const isActiveRunning =
          existing.status === 'running' && existingExpiresMs !== null && existingExpiresMs > nowMs;

        if (isActiveRunning) {
          throw new HarnessServiceError(
            409,
            'lease_conflict',
            'LEASE_HELD_BY_OTHER_OWNER',
            '该询价单当前正由另一未过期租约持有，禁止并发执行',
            true,
            {
              currentOwnerId:
                typeof existingPayload.ownerId === 'string' ? existingPayload.ownerId : null,
              currentFenceToken: existing.attempts,
              leaseExpiresAt:
                typeof existingPayload.leaseExpiresAt === 'string'
                  ? existingPayload.leaseExpiresAt
                  : null,
            },
          );
        }

        reclaimedExpiredLease = existing.status === 'running';
        fenceToken = existing.attempts + 1;
        taskId = existing.id;

        const updated = await tx.backgroundTask.updateMany({
          where: {
            id: existing.id,
            status: existing.status,
            attempts: existing.attempts,
            lockedBy: existing.lockedBy,
          },
          data: {
            status: 'running',
            attempts: fenceToken,
            lockedAt: now,
            lockedBy: nextLockedBy,
            completedAt: null,
            result: null,
            payload: JSON.stringify({
              inquiryId,
              environment: principal.environment,
              engine: 'deepagents-ts-harness',
              clientId: principal.clientId,
              ownerId,
              threadId,
              leaseToken,
              fenceToken,
              leaseDurationMs,
              leaseExpiresAt: expiresAt.toISOString(),
            }),
          },
        });

        if (updated.count !== 1) {
          throw new HarnessServiceError(
            409,
            'lease_conflict',
            'LEASE_HELD_BY_OTHER_OWNER',
            '租约竞争抢占失败，请重新核对状态后再试',
            true,
          );
        }

        await writeAuditLog(
          {
            actorId: `harness:${principal.clientId}`,
            actorEmail: `${principal.clientId}@harness.local`,
            action: reclaimedExpiredLease
              ? 'harness.lease.reclaimed_after_expiry'
              : 'harness.lease.claimed',
            resource: 'inquiries',
            targetType: 'Inquiry',
            targetId: inquiryId,
            before: {
              previousStatus: existing.status,
              previousFenceToken: existing.attempts,
              previousOwnerId:
                typeof existingPayload.ownerId === 'string' ? existingPayload.ownerId : null,
            },
            after: {
              taskId,
              ownerId,
              threadId,
              fenceToken,
              leaseExpiresAt: expiresAt.toISOString(),
            },
            reason: reclaimedExpiredLease
              ? '原执行租约已过期，新执行者递增栅栏令牌接管'
              : 'Harness 重新获取单询价执行租约',
          },
          tx,
        );
      }

      const inquiryVersion = await computeInquiryVersion(tx, inquiryId);
      return {
        status: 200,
        inquiryVersion,
        data: {
          taskId,
          inquiryId,
          ownerId,
          threadId,
          leaseToken,
          fenceToken,
          leaseExpiresAt: expiresAt.toISOString(),
          reclaimedExpiredLease,
        },
      };
    });
  } catch (err) {
    if (err instanceof HarnessServiceError) throw err;
    if (isUniqueConstraintError(err)) {
      throw new HarnessServiceError(
        409,
        'lease_conflict',
        'LEASE_HELD_BY_OTHER_OWNER',
        '租约并发创建冲突，请稍后核对',
        true,
      );
    }
    throw err;
  }
}

export async function releaseInquiryLeaseForHarness(
  inquiryId: string,
  input: ReleaseInquiryLeaseInput,
  principal: HarnessPrincipal,
) {
  const leaseToken = typeof input.leaseToken === 'string' ? input.leaseToken.trim() : '';
  if (!leaseToken || leaseToken.length > 128) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_LEASE_TOKEN', 'leaseToken 无效');
  }
  if (
    typeof input.fenceToken !== 'number' ||
    !Number.isSafeInteger(input.fenceToken) ||
    input.fenceToken <= 0
  ) {
    throw new HarnessServiceError(
      400,
      'validation_error',
      'INVALID_FENCE_TOKEN',
      'fenceToken 必须为正整数',
    );
  }
  if (input.action !== 'complete' && input.action !== 'cancel') {
    throw new HarnessServiceError(
      400,
      'validation_error',
      'INVALID_RELEASE_ACTION',
      'action 必须为 complete 或 cancel',
    );
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : undefined;
  if (input.reason !== undefined && reason && reason.length > 500) {
    throw new HarnessServiceError(
      400,
      'validation_error',
      'INVALID_RELEASE_REASON',
      'reason 不能超过 500 字',
    );
  }

  const dedupeKey = leaseDedupeKey(principal.environment, inquiryId);

  return await prisma.$transaction(async (tx) => {
    const row = await tx.backgroundTask.findUnique({ where: { dedupeKey } });
    const payload = jsonObject(row?.payload);
    if (
      !row ||
      row.type !== HARNESS_INQUIRY_LEASE_TASK_TYPE ||
      row.status !== 'running' ||
      row.attempts !== input.fenceToken ||
      payload.leaseToken !== leaseToken ||
      payload.clientId !== principal.clientId
    ) {
      throw new HarnessServiceError(
        409,
        'stale_lease',
        'LEASE_NOT_HELD',
        '租约已失效、已被取消或已由新执行者接管',
        false,
        {
          currentStatus: row?.status ?? null,
          currentFenceToken: row?.attempts ?? null,
        },
      );
    }

    const now = new Date();
    const expiresMs = parseExpiresAtMs(payload);
    const expiresAt = expiresMs === null ? null : new Date(expiresMs).toISOString();
    const nextStatus = input.action === 'cancel' ? 'cancelled' : 'succeeded';
    const finishedAt = now.toISOString();
    const result = JSON.stringify({
      action: input.action,
      reason: reason ?? null,
      fenceToken: input.fenceToken,
      finishedAt,
    });
    // Evaluate expiry in the same SQLite statement that changes the lease state.
    const updated = await tx.$executeRaw`
      UPDATE BackgroundTask
      SET status = ${nextStatus}, lockedAt = NULL, lockedBy = NULL,
          completedAt = ${finishedAt}, updatedAt = ${finishedAt}, result = ${result}
      WHERE id = ${row.id} AND type = ${HARNESS_INQUIRY_LEASE_TASK_TYPE}
        AND status = 'running' AND attempts = ${input.fenceToken}
        AND lockedBy IS ${row.lockedBy} AND payload = ${row.payload}
        AND strftime('%Y-%m-%dT%H:%M:%fZ', 'now') < ${expiresAt}
    `;

    if (updated !== 1) {
      throw new HarnessServiceError(
        409,
        'stale_lease',
        'LEASE_NOT_HELD',
        '租约已过期或状态已变更，释放失败',
        false,
      );
    }

    await writeAuditLog(
      {
        actorId: `harness:${principal.clientId}`,
        actorEmail: `${principal.clientId}@harness.local`,
        action: input.action === 'cancel' ? 'harness.lease.cancelled' : 'harness.lease.completed',
        resource: 'inquiries',
        targetType: 'Inquiry',
        targetId: inquiryId,
        after: {
          taskId: row.id,
          status: nextStatus,
          fenceToken: input.fenceToken,
          action: input.action,
          reason: reason ?? null,
        },
        reason:
          input.action === 'cancel'
            ? 'Harness 运行取消，释放租约并保留已提交业务事实'
            : 'Harness 完成本轮执行并释放租约',
      },
      tx,
    );

    const inquiryVersion = await computeInquiryVersion(tx, inquiryId);
    return {
      status: 200,
      inquiryVersion,
      data: {
        taskId: row.id,
        inquiryId,
        status: nextStatus,
        fenceToken: input.fenceToken,
        action: input.action,
      },
    };
  });
}

export async function assertActiveLeaseForWrite(
  tx: Prisma.TransactionClient,
  inquiryId: string,
  principal: HarnessPrincipal,
  leaseHeader?: HarnessLeaseHeader | null,
): Promise<void> {
  const row = await tx.backgroundTask.findUnique({
    where: { dedupeKey: leaseDedupeKey(principal.environment, inquiryId) },
  });
  const payload = jsonObject(row?.payload);
  const expiresMs = parseExpiresAtMs(payload);
  const nowMs = Date.now();
  const isUnexpiredRunning =
    row?.status === 'running' && expiresMs !== null && expiresMs > nowMs;

  if (leaseHeader) {
    if (
      !row ||
      row.type !== HARNESS_INQUIRY_LEASE_TASK_TYPE ||
      !isUnexpiredRunning ||
      row.attempts !== leaseHeader.fenceToken ||
      payload.leaseToken !== leaseHeader.leaseToken ||
      payload.clientId !== principal.clientId
    ) {
      throw new HarnessServiceError(
        409,
        'stale_lease',
        'STALE_WRITER_LEASE_REJECTED',
        '执行租约已过期、已取消或已被新 writer 接管，服务端已拒绝本次写入',
        false,
        {
          currentStatus: row?.status ?? null,
          currentFenceToken: row?.attempts ?? null,
        },
      );
    }
    return;
  }

  if (row) {
    throw new HarnessServiceError(
      409,
      'stale_lease',
      'ACTIVE_LEASE_REQUIRED',
      '当前询价已启用执行租约保护，须携带有效租约头才能写入',
      false,
      {
        currentStatus: row.status,
        currentFenceToken: row.attempts,
      },
    );
  }
}

export async function readInquiryLeaseSummary(
  db: Db,
  environment: string,
  inquiryId: string,
): Promise<InquiryLeaseSummary | null> {
  const row = await db.backgroundTask.findUnique({
    where: { dedupeKey: leaseDedupeKey(environment, inquiryId) },
  });
  if (!row || row.type !== HARNESS_INQUIRY_LEASE_TASK_TYPE) return null;

  const payload = jsonObject(row.payload);
  const expiresIso = typeof payload.leaseExpiresAt === 'string' ? payload.leaseExpiresAt : null;
  const expiresMs = parseExpiresAtMs(payload);
  return {
    taskId: row.id,
    status: row.status,
    ownerId: typeof payload.ownerId === 'string' ? payload.ownerId : null,
    threadId: typeof payload.threadId === 'string' ? payload.threadId : null,
    fenceToken: row.attempts,
    leaseExpiresAt: expiresIso,
    expired: expiresMs !== null ? expiresMs <= Date.now() : false,
  };
}
