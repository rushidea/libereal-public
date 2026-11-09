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
if (typeArgs.length > 1 || (typeArgs.length === 1 && typeArgs[0] !== '--type=aiops.run') || process.argv.includes('--type')) {
  throw new Error('Only --type=aiops.run is supported');
}
const aiOpsOnly = typeArgs.length === 1;
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
  await recoverStaleBackgroundTasks();
  let lastScheduleAt = 0;

  while (!stopping) {
    const now = new Date();
    if (now.getTime() - lastScheduleAt >= 60_000) {
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
      await completeBackgroundTask(task.id, workerId, result);
      console.info(`[task-worker] succeeded ${task.type} ${task.id}`);
    } catch (error) {
      await failBackgroundTask(task.id, workerId, error);
      console.error(`[task-worker] failed ${task.type} ${task.id}`, error);
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
