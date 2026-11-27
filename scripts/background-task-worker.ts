#!/usr/bin/env npx tsx
import 'dotenv/config';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  claimNextBackgroundTask,
  completeBackgroundTask,
  enqueueBackgroundTask,
  failBackgroundTask,
  recoverStaleBackgroundTasks,
} from '@/lib/background-tasks';
import { executeBackgroundTask } from '@/lib/background-task-handlers';
import { prisma } from '@/lib/prisma';
import { runMfaChallengeCleanupOnce } from '@/lib/security/mfa-cleanup';

const once = process.argv.includes('--once');
const typeArgs = process.argv.filter((arg) => arg.startsWith('--type='));
if (typeArgs.length > 1 || (typeArgs.length === 1 && !['--type=aiops.run','--type=order.purchase_prepare'].includes(typeArgs[0])) || process.argv.includes('--type')) {
  throw new Error('Unsupported worker type');
}
const aiOpsOnly = typeArgs[0] === '--type=aiops.run';
const purchaseOnly = typeArgs[0] === '--type=order.purchase_prepare';
const stopController = new AbortController();
const pollMs = Math.max(250, Number(process.env.TASK_WORKER_POLL_MS) || 2000);
const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function scheduleRecurringTasks(now: Date): Promise<void> {
  await enqueueBackgroundTask('news.update', {}, {
    priority: -10,
    maxAttempts: 3,
    dedupeKey: `news-update:${dayKey(now)}`,
  });
  const mfaCleanupBucket = Math.floor(now.getTime() / (15 * 60 * 1000));
  await enqueueBackgroundTask('security.mfa_cleanup', {}, {
    priority: -20,
    maxAttempts: 3,
    dedupeKey: `mfa-cleanup:${mfaCleanupBucket}`,
  });
}

async function run(): Promise<void> {
  console.info(`[task-worker] started ${workerId}`);
  if (purchaseOnly) {
    const { discoverOrderPurchaseWork, runOrderPurchaseContinuationOnce } = await import('@/lib/purchase-continuation-worker');
    let nextDiscovery = 0;
    while (!stopping) {
      try {
        if (Date.now() >= nextDiscovery) {
          const count = await discoverOrderPurchaseWork();
          nextDiscovery = count === 16 ? 0 : Date.now() + 60_000;
        }
        const receipt = await runOrderPurchaseContinuationOnce();
        if (once) break;
        if (!receipt) await sleep(pollMs);
      } catch (error) {
        if (once) throw error;
        console.error('[task-worker] order preparation temporarily unavailable', error instanceof Error ? error.name : 'error');
        await sleep(pollMs);
      }
    }
    return;
  }
  if (aiOpsOnly) {
    const { claimAiOpsTask, recoverStaleAiOpsTasks } = await import('@/lib/ai-ops/tasks');
    const { runAiOpsTask } = await import('@/lib/ai-ops/runtime-composition');
    await recoverStaleAiOpsTasks();
    let lastRecoveryAt = Date.now();
    while (!stopping) {
      if (Date.now() - lastRecoveryAt >= 60_000) { await recoverStaleAiOpsTasks(); lastRecoveryAt = Date.now(); }
      const task = await claimAiOpsTask(workerId);
      if (task) await runAiOpsTask(task, { workerId, signal: stopController.signal });
      if (once) break;
      if (!task) await sleep(pollMs);
    }
    return;
  }
  let lastScheduleAt = 0;

  while (!stopping) {
    const now = new Date();
    if (now.getTime() - lastScheduleAt >= 60_000) {
      await recoverStaleBackgroundTasks(now);
      await scheduleRecurringTasks(now);
      lastScheduleAt = now.getTime();
    }

    const task = await claimNextBackgroundTask(workerId, now);
    if (!task) {
      if (once) break;
      await sleep(pollMs);
      continue;
    }

    try {
      const result = await executeBackgroundTask(task);
      if (await completeBackgroundTask(task.id, task.lockedBy!, result)) console.info(`[task-worker] succeeded ${task.type} ${task.id}`);
    } catch (error) {
      if (await failBackgroundTask(task.id, task.lockedBy!, error)) console.error(`[task-worker] failed ${task.type} ${task.id}`, error);
    }
    if (once) break;
  }
}

process.on('SIGINT', () => { stopping = true; stopController.abort(); });
process.on('SIGTERM', () => { stopping = true; stopController.abort(); });

run()
  .catch((error) => {
    console.error('[task-worker] fatal error', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
