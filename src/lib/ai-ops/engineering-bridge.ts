import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { revalidateAiOpsActor } from './business';
import { readBusinessSnapshot, requireWorkerPermissions } from './business-tools';
import { isBusinessWorker, validateBusinessAnalysis } from './business-core';
import { persistentBudgetLedger, sha256 } from './model-client';
import { loadAiOpsPolicy, type AiOpsPolicy } from './policy';
import { claimAiOpsTask, parseAiOpsPayload, parseAiOpsSummary, recoverStaleAiOpsTasks, updateAiOpsProgress } from './tasks';
import { taskModelAccounting } from './model-accounting';
import { ENGINEERING_STAGES, runnerPolicyScope, parseBridgeRequest, safeEngineeringLinks, type BridgeScope } from './bridge-protocol';
import type { AiOpsSummary } from './contracts';
export const ENGINEERING_LEASE_MS = 45000;
const RUNNER_TYPE = 'aiops.control.runner';
const runnerKey = (id: string) => `aiops-runner-${sha256(id)}`;
export function bridgeScope(policy: AiOpsPolicy): BridgeScope {
    return runnerPolicyScope(policy);
}
export async function engineeringAvailability() {
    const policy = await loadAiOpsPolicy().catch(() => null);
    const row = await prisma.backgroundTask.findFirst({
        where: { type: RUNNER_TYPE, status: 'succeeded', lockedAt: { gte: new Date(Date.now() - 60000) } }, orderBy: { lockedAt: 'desc' }
    });
    const c = row ? JSON.parse(row.payload).capabilities : {};
    return {
        available: Boolean(policy?.engineering && c.engineering), businessAvailable: Boolean(policy && c.business), reason: row ? null : 'runner_offline', stagingAvailable: Boolean(policy?.engineering?.staging && c.engineering && c.staging)
    };
}
// Existing fixed SSH service-account transport only. No new HTTP credentials.
export async function handleEngineeringBridge(value: unknown) {
    const policy = await loadAiOpsPolicy();
    if (!policy)
        throw new Error('aiops_policy_not_configured');
    const input = parseBridgeRequest(value, policy.engineering?.staging?.url);
    if (input.op === 'claim') {
        await prisma.backgroundTask.upsert({
            where: { id: runnerKey(input.runnerId) }, create: {
                id: runnerKey(input.runnerId), type: RUNNER_TYPE, status: 'succeeded', maxAttempts: 1, payload: JSON.stringify({ capabilities: input.capabilities }), lockedAt: new Date(), completedAt: new Date()
            }, update: { payload: JSON.stringify({ capabilities: input.capabilities }), lockedAt: new Date() }
        });
        if (!input.capabilities.business)
            return { ok: true, job: null };
        // This website-side transition is required even when the old ECS worker is stopped.
        // Expiry is terminal reconciliation, never a retry or a budget refund.
        await recoverStaleAiOpsTasks(new Date(), ENGINEERING_LEASE_MS);
        // Lease encodes the runner identity without exposing the creating actor/session.
        const leaseId = randomUUID();
        const task = await claimAiOpsTask(`${input.runnerId}:${leaseId}`, new Date(), true);
        if (!task)
            return { ok: true, job: null };
        const payload = parseAiOpsPayload(task.payload);
        try {
            const actor = await revalidateAiOpsActor(payload.actor);
            if (!actor.permissions.includes('tasks.manage'))
                throw new Error('aiops_actor_forbidden');
            if (payload.workerId && isBusinessWorker(payload.workerId))
                requireWorkerPermissions(payload.workerId, actor.permissions);
            if (payload.kind === 'engineering' && !input.capabilities.engineering)
                throw new Error('engineering_not_configured');
            const summary: AiOpsSummary = {
                version: 1, kind: payload.kind, stage: 'supervisor', status: 'running', updatedAt: new Date().toISOString()
            };
            if (!await updateAiOpsProgress(task.id, task.lockedBy!, summary))
                throw new Error('aiops_bridge_lease_lost');
            const bound = await prisma.backgroundTask.updateMany({
                where: { id: task.id, status: 'running', lockedBy: task.lockedBy },
                data: { lastError: JSON.stringify({ scopeHash: sha256(JSON.stringify(bridgeScope(policy))) }) },
            });
            if (bound.count !== 1)
                throw new Error('aiops_bridge_lease_lost');
            return {
                ok: true, job: {
                    taskId: task.id, request: payload.request, kind: payload.kind, workerId: payload.workerId, leaseId, scope: bridgeScope(policy)
                }
            };
        }
        catch (error) {
            await updateAiOpsProgress(task.id, task.lockedBy!, {
                version: 1, kind: payload.kind, stage: 'needs_reconciliation', status: 'failed', failureCode: 'permission_denied', updatedAt: new Date().toISOString()
            }, 'failed');
            throw error;
        }
    }
    const owner = `${input.runnerId}:${input.leaseId}`;
    const task = await prisma.backgroundTask.findFirst({
        where: {
            id: input.taskId, type: 'aiops.run', status: 'running', lockedBy: owner, lockedAt: { gte: new Date(Date.now() - ENGINEERING_LEASE_MS) }
        }
    });
    if (!task)
        throw new Error('aiops_bridge_lease_lost');
    const payload = parseAiOpsPayload(task.payload);
    const actor = await revalidateAiOpsActor(payload.actor);
    if (!actor.permissions.includes('tasks.manage'))
        throw new Error('aiops_actor_forbidden');
    const previous = parseAiOpsSummary(task.result);
    const metadata = JSON.parse(task.lastError || '{}');
    if (!previous || metadata.scopeHash !== sha256(JSON.stringify(bridgeScope(policy)))) {
        throw new Error('engineering_scope_invalid');
    }
    if (previous.kind === 'business' && previous.workerId && isBusinessWorker(previous.workerId))
        requireWorkerPermissions(previous.workerId, actor.permissions);
    const held = await prisma.backgroundTask.updateMany({
        where: { id: task.id, status: 'running', lockedBy: owner, lockedAt: task.lockedAt }, data: { lockedAt: new Date() }
    });
    if (held.count !== 1)
        throw new Error('aiops_bridge_lease_lost');
    await prisma.backgroundTask.updateMany({ where: { id: runnerKey(input.runnerId), type: RUNNER_TYPE }, data: { lockedAt: new Date() } });
    const save = async (summary: AiOpsSummary, terminal?: 'succeeded' | 'failed') => {
        const changed = await prisma.backgroundTask.updateMany({
            where: { id: task.id, type: 'aiops.run', status: 'running', lockedBy: owner, result: task.result },
            data: {
                result: JSON.stringify({ ...summary, status: terminal ?? 'running', updatedAt: new Date().toISOString() }),
                ...(terminal ? { status: terminal, completedAt: new Date(), lockedBy: null, lockedAt: null, lastError: null } : {}),
            },
        });
        if (changed.count !== 1)
            throw new Error('aiops_bridge_lease_lost');
    };
    if (input.op === 'checkpoint') {
        if (input.action === 'route') {
            if (previous.stage !== 'supervisor')
                throw new Error('aiops_bridge_invalid');
            if (input.decision.kind === 'business') {
                if (!isBusinessWorker(input.decision.workerId))
                    throw new Error('aiops_domain_invalid');
                requireWorkerPermissions(input.decision.workerId, actor.permissions);
                await save({ ...previous, kind: 'business', stage: 'business', workerId: input.decision.workerId });
            }
            else {
                if (!policy.engineering)
                    throw new Error('engineering_not_configured');
                await save({ ...previous, kind: 'engineering', stage: 'proposal', workerId: 'engineering_supervisor' });
            }
        }
        else if (input.action === 'snapshot') {
            if (previous.stage !== 'business' || previous.workerId !== input.workerId || !isBusinessWorker(input.workerId))
                throw new Error('aiops_domain_invalid');
            const snapshot = await readBusinessSnapshot(input.workerId, actor.permissions);
            // Bind the exact projection metadata to this lease for finish validation.
            const changed = await prisma.backgroundTask.updateMany({
                where: { id: task.id, status: 'running', lockedBy: owner, result: task.result, lastError: task.lastError },
                data: { lastError: JSON.stringify({ ...metadata, asOf: snapshot.asOf, source: snapshot.source }) },
            });
            if (changed.count !== 1)
                throw new Error('aiops_bridge_lease_lost');
            return { ok: true, snapshot };
        }
        else if (input.action === 'budget_reserve') {
            const stage = previous.stage === 'business' ? `business:${previous.workerId}` : previous.stage;
            if (previous.stage === 'business' && !metadata.asOf)
                throw new Error('aiops_bridge_invalid');
            if (input.call.stage !== stage)
                throw new Error('aiops_bridge_invalid');
            await persistentBudgetLedger.reserve(policy, { ...input.call, taskId: task.id, leaseId: input.leaseId, startedAt: new Date().toISOString() });
        }
        else if (input.action === 'budget_settle') {
            const call = await prisma.backgroundTask.findUnique({ where: { id: input.callId } });
            const state = call && JSON.parse(call.payload);
            if (!call ||
                call.type !== 'aiops.control.call' ||
                state.taskId !== task.id ||
                state.leaseId !== input.leaseId ||
                state.inputHash !== input.result.inputHash)
                throw new Error('aiops_budget_call_invalid');
            await persistentBudgetLedger.settle(policy, input.callId, input.result);
        }
        else if (input.action === 'progress') {
            if (!input.progress || previous.kind !== 'engineering')
                throw new Error('aiops_bridge_invalid');
            const next = ENGINEERING_STAGES.indexOf(input.progress.stage), current = ENGINEERING_STAGES.indexOf(previous.stage);
            if (next < current || next > current + 1)
                throw new Error('aiops_bridge_invalid');
            const links = safeEngineeringLinks(input.progress.links ?? {}, policy.engineering?.staging?.url);
            if (previous.links?.pr && links.pr && links.pr !== previous.links.pr)
                throw new Error('aiops_bridge_invalid');
            await save({ ...previous, stage: input.progress.stage, links: { ...previous.links, ...links } });
        }
        return { ok: true };
    }
    if (input.result.terminalStage === 'complete') {
        if (previous.kind !== 'business' || previous.stage !== 'business' || !input.result.output || input.result.links || input.result.artifacts)
            throw new Error('aiops_bridge_invalid');
        const output = JSON.parse(input.result.output);
        if (Object.keys(output).sort().join(',') !== 'analysis,asOf,source,version,workerId' ||
            output.version !== 1 ||
            output.workerId !== previous.workerId ||
            output.asOf !== metadata.asOf ||
            output.source !== metadata.source)
            throw new Error('aiops_business_output_invalid');
        validateBusinessAnalysis(output.analysis);
        const accounting = await taskModelAccounting(task.id);
        const stages = accounting.records.map((record) => record.stage).sort();
        const expected = [`business:${previous.workerId}`, 'supervisor'].sort();
        if (accounting.unknownReservedNanousd !== 0 || JSON.stringify(stages) !== JSON.stringify(expected)) {
            throw new Error('aiops_budget_call_invalid');
        }
        await save({ ...previous, stage: 'complete', output: input.result.output, usage: accounting.usage }, 'succeeded');
    }
    else {
        const links = {
            ...previous.links, ...safeEngineeringLinks(input.result.links ?? {}, policy.engineering?.staging?.url)
        };
        if (previous.links?.pr && links.pr !== previous.links.pr)
            throw new Error('aiops_bridge_invalid');
        if (input.result.terminalStage === 'awaiting_production_approval' && (previous.kind !== 'engineering' ||
            previous.stage !== 'staging' ||
            !links.pr ||
            !links.ci ||
            !links.staging ||
            !input.result.artifacts?.treeSha256 ||
            input.result.artifacts.privateCommit !== policy.engineering?.staging?.privateCommit))
            throw new Error('aiops_bridge_invalid');
        if (input.result.artifacts && previous.kind !== 'engineering') {
            throw new Error('aiops_bridge_invalid');
        }
        await save({
            ...previous,
            stage: input.result.terminalStage,
            failureCode: input.result.safeErrorCode,
            links,
            ...(input.result.artifacts ? { artifacts: input.result.artifacts } : {}),
        }, input.result.terminalStage === 'awaiting_production_approval' ? 'succeeded' : 'failed');
    }
    return { ok: true };
}
