import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse as parseEnv } from 'dotenv';
import { runEngineeringTaskCore, engineeringHostAvailability, type EngineeringInput } from './engineering';
import { createBudgetedModelClient, sendOpenAiResponse, type BudgetLedger } from './model-client-core';
import { parseAiOpsPolicy, type AiOpsPolicy } from './policy';
import { object, safeErrorCode, type BridgeJob, type BridgeRequest, type BridgeResult } from './bridge-protocol';

const exec = promisify(execFile);
const SERVER_COMMAND = '/usr/local/libexec/libereal-aiops-bridge';
const KEY_PATH = '/Users/peter/libereal-private/.env';
export type LocalRunnerConfig = { version: 1; runnerId: string; policyPath: string; ssh: { host: 'libereal-ecs'; command: typeof SERVER_COMMAND } };
export function parseLocalRunnerConfig(value: unknown): LocalRunnerConfig {
  if (!object(value) || Object.keys(value).length !== 4 || value.version !== 1 || typeof value.runnerId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.runnerId) || typeof value.policyPath !== 'string' || !path.isAbsolute(value.policyPath) || value.policyPath.includes('\0') || !object(value.ssh) || Object.keys(value.ssh).length !== 2 || value.ssh.host !== 'libereal-ecs' || value.ssh.command !== SERVER_COMMAND) throw new Error('aiops_runner_config_invalid');
  return value as LocalRunnerConfig;
}
export async function readLocalRunnerConfiguration(configPath: string) {
  if (!path.isAbsolute(configPath)) throw new Error('aiops_runner_config_invalid');
  const config = parseLocalRunnerConfig(JSON.parse(await readFile(configPath, 'utf8')));
  const policy = parseAiOpsPolicy(JSON.parse(await readFile(config.policyPath, 'utf8')));
  if (!policy.engineering) throw new Error('engineering_not_configured');
  return { config, policy };
}
function cleanSshEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(['HOME', 'PATH', 'USER', 'LOGNAME', 'SSH_AUTH_SOCK', 'LANG'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])) as NodeJS.ProcessEnv;
}
async function sshJson(config: LocalRunnerConfig, request: BridgeRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/ssh', ['-F', '/Users/peter/.ssh/config', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'UserKnownHostsFile=/Library/LiberealBL/staging-known-hosts', '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', 'ForwardAgent=no', config.ssh.host, config.ssh.command], { env: cleanSshEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let size = 0; let ended = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('aiops_bridge_transport_unknown')); }, 20_000);
    function finish(error?: Error, result?: Record<string, unknown>) { if (ended) return; ended = true; clearTimeout(timer); if (error) reject(error); else resolve(result!); }
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 65_536) { child.kill('SIGTERM'); finish(new Error('aiops_bridge_transport_unknown')); } else chunks.push(chunk); });
    // Never forward SSH stderr: it can contain private paths or service diagnostics.
    child.stderr.resume();
    child.on('error', () => finish(new Error('aiops_bridge_transport_unknown')));
    child.stdin.on('error', () => finish(new Error('aiops_bridge_transport_unknown')));
    child.on('close', (code) => { try { const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (code !== 0 || !object(result) || result.ok !== true) throw new Error(); finish(undefined, result); } catch { finish(new Error('aiops_bridge_transport_unknown')); } });
    child.stdin.end(JSON.stringify(request));
  });
}
export function createBridgeClient(config: LocalRunnerConfig, transport = sshJson) {
  // Heartbeats, reservations, progress and finish share one ordered channel. A failed or
  // ambiguous request poisons this session: no retry, duplicate settlement or next job.
  let failed = false;
  let tail: Promise<unknown> = Promise.resolve();
  return (request: BridgeRequest) => {
    const pending = tail.then(async () => { if (failed) throw new Error('aiops_bridge_lease_lost'); try { return await transport(config, request); } catch (error) { failed = true; throw error; } });
    tail = pending.catch(() => undefined);
    return pending;
  };
}
export async function localStagingExecutor(policy: AiOpsPolicy): Promise<EngineeringInput['stagingExecutor']> {
  const cfg = policy.engineering;
  const stage = cfg?.staging;
  if (!cfg || !stage) return undefined;
  const root = path.dirname(path.dirname(path.dirname(stage.configPath)));
  if (await realpath(root) !== root || stage.command !== path.join(root, 'operations/staging/aiops-systemd-release.py') || stage.configPath !== path.join(root, 'operations/staging/aiops-systemd-host.json')) throw new Error('staging_host_invalid');
  const top = await exec('/usr/bin/git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-C', root, 'rev-parse', '--show-toplevel'], { env: cleanSshEnvironment() });
  if (top.stdout.trim() !== root) throw new Error('staging_host_invalid');
  async function verify() {
    const listing = await exec('/usr/bin/git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-C', root, 'ls-tree', '-r', '-z', stage!.privateCommit, '--', 'operations/production', 'operations/staging'], { maxBuffer: 2_000_000, env: cleanSshEnvironment() });
    const tracked = new Set<string>();
    for (const entry of listing.stdout.split('\0').filter(Boolean)) {
      const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(entry);
      if (!match) throw new Error('staging_pin_invalid');
      const relative = match[2];
      if (relative.includes('/tests/') || relative.endsWith('.md')) continue;
      const filename = path.join(root, relative);
      if ((await lstat(filename)).isSymbolicLink() || await realpath(filename) !== filename) throw new Error('staging_pin_invalid');
      const [actual, expected] = await Promise.all([readFile(filename), exec('/usr/bin/git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-C', root, 'show', `${stage!.privateCommit}:${relative}`], { encoding: 'buffer', maxBuffer: 2_000_000, env: cleanSshEnvironment() })]);
      if (!actual.equals(expected.stdout)) throw new Error('staging_pin_invalid');
      tracked.add(relative);
    }
    if (!tracked.has('operations/staging/aiops-systemd-release.py') || !tracked.has('operations/staging/aiops-systemd-host.json') || createHash('sha256').update(await readFile(stage!.command)).digest('hex') !== stage!.commandSha256) throw new Error('staging_pin_invalid');
    async function untrackedPython(folder: string): Promise<void> {
      for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
        const relative = `${folder}/${entry.name}`;
        if (entry.name === 'tests' || entry.name === '__pycache__') continue;
        if (entry.isDirectory()) await untrackedPython(relative);
        else if ((entry.name.endsWith('.py') || relative.startsWith('operations/staging/runtime/')) && (!entry.isFile() || !tracked.has(relative))) throw new Error('staging_pin_invalid');
      }
    }
    await untrackedPython('operations/production'); await untrackedPython('operations/staging');
  }
  await access('/usr/bin/python3', 1); await verify();
  return async (request, signal) => {
    await verify();
    return new Promise((resolve, reject) => {
      const env = cleanSshEnvironment();
      const child = spawn('/usr/bin/python3', ['-I', '-B', stage.command], { cwd: root, signal, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let bytes = 0; const chunks: Buffer[] = [];
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('staging_outcome_unknown')); }, 30 * 60_000);
      child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65_536) child.kill('SIGTERM'); else chunks.push(chunk); });
      child.stderr.resume();
      child.stdin.on('error', () => undefined);
      child.on('error', () => { clearTimeout(timer); reject(new Error('staging_outcome_unknown')); });
      child.on('close', (code) => { clearTimeout(timer); try { if (code !== 0 || bytes > 65_536) throw new Error(); resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('staging_outcome_unknown')); } });
      child.stdin.end(JSON.stringify({ taskId: request.taskId, publicCommit: request.publicCommit, privateCommit: request.privateCommit }));
    });
  };
}
export function validateJobScope(job: BridgeJob, policy: AiOpsPolicy) {
  const e = policy.engineering; const remote = job.scope;
  if (!e || remote.model !== policy.model || remote.budgetScope !== policy.budgetScope || remote.maxBudgetNanousd !== policy.maxBudgetNanousd || remote.engineering.repository !== e.repository || remote.engineering.baseRef !== e.baseRef || remote.engineering.baseBranch !== e.baseBranch || JSON.stringify(remote.engineering.allowedPaths) !== JSON.stringify(e.allowedPaths)) throw new Error('engineering_scope_invalid');
}
export async function runLocalEngineeringRunner(config: LocalRunnerConfig, policy: AiOpsPolicy, signal: AbortSignal, once = false) {
  if (process.version !== 'v26.13.0') throw new Error('aiops_runner_node_version');
  const host = await engineeringHostAvailability(policy);
  let stagingExecutor: EngineeringInput['stagingExecutor'];
  try { stagingExecutor = await localStagingExecutor(policy); } catch { /* Report staging unavailable; engineering can still create its actual PR/CI. */ }
  const rpc = createBridgeClient(config);
  // Read the one canonical file, without mutating process.env or writing a key copy.
  const key = parseEnv(await readFile(KEY_PATH, 'utf8')).OPENAI_API_KEY?.trim();
  if (!key) throw new Error('aiops_provider_not_configured');
  while (!signal.aborted) {
    const claimed = await rpc({ version: 1, op: 'claim', runnerId: config.runnerId, capabilities: { engineering: host.available, staging: Boolean(stagingExecutor) } });
    if (claimed.job) {
      const job = claimed.job as BridgeJob;
      try { validateJobScope(job, policy); } catch (error) { await rpc({ version: 1, op: 'finish', runnerId: config.runnerId, taskId: job.taskId, leaseId: job.leaseId, result: { terminalStage: 'needs_connection', safeErrorCode: 'engineering_scope_invalid' } }); throw error; }
      const controller = new AbortController();
      const stop = () => controller.abort(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) controller.abort();
      const base = { version: 1 as const, runnerId: config.runnerId, taskId: job.taskId, leaseId: job.leaseId };
      const check = async () => { if (controller.signal.aborted) throw new Error('aiops_bridge_lease_lost'); await rpc({ ...base, op: 'checkpoint', action: 'check' }); if (controller.signal.aborted) throw new Error('aiops_bridge_lease_lost'); };
      let heartbeatRunning = false;
      const timer = setInterval(() => { if (heartbeatRunning || controller.signal.aborted) return; heartbeatRunning = true; check().catch(stop).finally(() => { heartbeatRunning = false; }); }, 10_000);
      const ledger: BudgetLedger = {
        async reserve(_policy, call) { await rpc({ ...base, op: 'checkpoint', action: 'budget_reserve', call: { id: call.id, stage: call.stage, inputHash: call.inputHash, startedAt: call.startedAt } }); },
        async settle(_policy, callId, result) { await rpc({ ...base, op: 'checkpoint', action: 'budget_settle', callId, result }); },
      };
      const model = createBudgetedModelClient({ ledger, transport: sendOpenAiResponse, key: () => key });
      let result: BridgeResult;
      try {
        const actual = await runEngineeringTaskCore({ policy, model, stagingExecutor, taskId: job.taskId, request: job.request, signal: controller.signal, assertActive: check,
          onProgress: async (progress) => { await rpc({ ...base, op: 'checkpoint', action: 'progress', progress }); },
        });
        result = { terminalStage: actual.terminalStage, links: actual.links, ...('artifacts' in actual && actual.artifacts ? { artifacts: actual.artifacts } : {}), ...('safeErrorCode' in actual && actual.safeErrorCode ? { safeErrorCode: actual.safeErrorCode } : {}) };
      } catch (error) { result = { terminalStage: 'needs_reconciliation', safeErrorCode: safeErrorCode(error) }; }
      finally { clearInterval(timer); signal.removeEventListener('abort', stop); }
      // If the SSH session has failed this call is rejected locally, never replayed.
      await rpc({ ...base, op: 'finish', result });
      if (result.terminalStage === 'needs_reconciliation') throw new Error('engineering_execution_unknown');
    }
    if (once || signal.aborted) break;
    await new Promise<void>((resolve) => { const timer = setTimeout(done, 10_000); function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); } signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done(); });
  }
}
