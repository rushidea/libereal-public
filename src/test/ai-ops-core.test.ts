import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';
import { prisma } from '@/lib/prisma';
import { assessRequiredCiJobs } from '@/lib/ai-ops/engineering';
import { createAiOpsRuntime } from '@/lib/ai-ops/runtime';
import { claimNextBackgroundTask, enqueueBackgroundTask, recoverStaleBackgroundTasks, retryBackgroundTask } from '@/lib/background-tasks';
import { cancelAiOpsTask, claimAiOpsTask, enqueueAiOpsTask, projectAiOpsTask, recoverStaleAiOpsTasks, updateAiOpsProgress } from '@/lib/ai-ops/tasks';

const actor = { id: 'admin', sessionId: 'secret-session' };
describe('AI task queue isolation', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });
  it('keeps old workers and recovery away from AI tasks and control records', async () => {
    const ai = await enqueueAiOpsTask({ request: 'private prompt', kind: 'auto', actor });
    await prisma.backgroundTask.create({ data: { type: 'aiops.control.budget', payload: '{}', status: 'pending' } });
    const email = await enqueueBackgroundTask('email.send', {});
    expect((await claimNextBackgroundTask('legacy'))?.id).toBe(email.id);
    expect(await claimNextBackgroundTask('legacy')).toBeNull();
    await prisma.backgroundTask.update({ where: { id: ai.id }, data: { status: 'running', lockedBy: 'lost', lockedAt: new Date(0), attempts: 1 } });
    await prisma.backgroundTask.update({ where: { id: ai.id }, data: { result: JSON.stringify({ version: 1, kind: 'engineering', stage: 'ci', status: 'running', updatedAt: new Date().toISOString(), links: { pr: 'https://github.com/rushidea/libereal-public/pull/123' }, usage: { totalTokens: 42 } }) } });
    await recoverStaleBackgroundTasks();
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: ai.id } })).status).toBe('running');
    expect(await recoverStaleAiOpsTasks()).toBe(1);
    const recovered = JSON.parse((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: ai.id } })).result!);
    expect(recovered.links.pr).toBe('https://github.com/rushidea/libereal-public/pull/123');
    expect(recovered.usage.totalTokens).toBe(42);
    expect(await retryBackgroundTask(ai.id)).toBeNull();
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: ai.id } })).status).toBe('failed');
  });
  it('allows only one running AI task and fences a cancelled worker', async () => {
    const first = await enqueueAiOpsTask({ request: 'private prompt', kind: 'business', actor });
    await enqueueAiOpsTask({ request: 'another', kind: 'engineering', actor });
    expect(await claimAiOpsTask('legacy-website-worker')).toBeNull();
    const claimed = await claimAiOpsTask('worker', new Date(), true);
    expect(claimed?.id).toBe(first.id);
    expect(await claimAiOpsTask('other', new Date(), true)).toBeNull();
    await updateAiOpsProgress(first.id, 'worker', { version: 1, kind: 'business', workerId: 'catalog', stage: 'business', status: 'running', updatedAt: new Date().toISOString(), links: { pr: 'https://github.com/rushidea/libereal-public/pull/123', ci: 'https://github.com/rushidea/libereal-public/actions/runs/456' }, usage: { totalTokens: 9 } });
    expect(await cancelAiOpsTask(first.id)).toBe(true);
    const row = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: first.id } });
    expect(JSON.parse(row.result!).stage).toBe('needs_reconciliation');
    expect(JSON.parse(row.result!).links.ci).toBe('https://github.com/rushidea/libereal-public/actions/runs/456');
    expect(JSON.parse(row.result!).workerId).toBe('catalog');
    expect(JSON.parse(row.result!).usage.totalTokens).toBe(9);
    expect(await updateAiOpsProgress(first.id, 'worker', { version: 1, kind: 'business', stage: 'complete', status: 'succeeded', updatedAt: new Date().toISOString() }, 'succeeded')).toBe(false);
    expect(await retryBackgroundTask(first.id)).toBeNull();
  });
  it('does not commit two active claims under concurrent workers', async () => {
    await enqueueAiOpsTask({ request: 'first', kind: 'business', actor });
    await enqueueAiOpsTask({ request: 'second', kind: 'engineering', actor });
    const outcomes = await Promise.allSettled([claimAiOpsTask('one', new Date(), true), claimAiOpsTask('two', new Date(), true)]);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled' && outcome.value)).toBe(true);
    expect(await prisma.backgroundTask.count({ where: { type: 'aiops.run', status: 'running' } })).toBe(1);
  });
  it('projects only approved fields, never raw request, session, output or error', async () => {
    const task = await enqueueAiOpsTask({ request: 'private prompt', kind: 'business', actor });
    const row = await prisma.backgroundTask.update({ where: { id: task.id }, data: { lastError: 'sensitive error', result: JSON.stringify({ version: 1, kind: 'business', stage: 'business', status: 'running', updatedAt: new Date().toISOString(), output: 'private row', links: { pr: 'https://example.test/pr?token=secret' } }) } });
    const serialized = JSON.stringify(projectAiOpsTask(row));
    for (const secret of ['private prompt', 'secret-session', 'sensitive error', 'private row', 'token=secret']) expect(serialized).not.toContain(secret);
  });
  it('requires all six workflow jobs before marking CI passed', () => {
    const names = ['security-audit', 'lint-and-type', 'unit-tests', 'catalog-search-promotion-validation', 'e2e-tests', 'build'];
    const jobs = names.map((name) => ({ name, status: 'completed', conclusion: 'success' }));
    expect(assessRequiredCiJobs(jobs.slice(0, 5))).toBe('pending');
    expect(assessRequiredCiJobs([...jobs, jobs[0]])).toBe('pending');
    expect(assessRequiredCiJobs(jobs.map((job) => job.name === 'build' ? { ...job, conclusion: 'failure' } : job))).toBe('failed');
    expect(assessRequiredCiJobs(jobs)).toBe('passed');
  });
  it('keeps validated PR and run links if a later CI step fails', async () => {
    const task = await enqueueAiOpsTask({ request: 'change', kind: 'engineering', actor });
    const claimed = await claimAiOpsTask('worker', new Date(), true);
    const run = createAiOpsRuntime({
      revalidateActor: async (a) => ({ ...a, permissions: ['tasks.manage'] }),
      route: async () => ({ kind: 'engineering' }),
      business: async () => ({}),
      engineering: async ({ onProgress }) => {
        await onProgress({ stage: 'ci', links: { pr: 'https://github.com/rushidea/libereal-public/pull/123', ci: 'https://github.com/rushidea/libereal-public/actions/runs/456' } });
        throw new Error('later CI failure');
      },
    });
    await run(claimed!, { workerId: 'worker' });
    const row = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(JSON.parse(row.result!).links).toEqual({ pr: 'https://github.com/rushidea/libereal-public/pull/123', ci: 'https://github.com/rushidea/libereal-public/actions/runs/456' });
    expect(JSON.parse(row.result!).stage).toBe('needs_reconciliation');
  });

});
