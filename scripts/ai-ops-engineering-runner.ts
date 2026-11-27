import { readLocalRunnerConfiguration, runLocalEngineeringRunner } from '../src/lib/ai-ops/engineering-runner';
import { safeErrorCode } from '../src/lib/ai-ops/bridge-protocol';
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
const path = process.argv[2];
if (!path || process.argv.slice(3).some((arg) => arg !== '--once')) throw new Error('Usage: ai-ops-engineering-runner.ts ABSOLUTE_PRIVATE_CONFIG [--once]');
readLocalRunnerConfiguration(path).then(({ config, policy }) => runLocalEngineeringRunner(config, policy, controller.signal, process.argv.includes('--once'))).catch((error: unknown) => { console.error(JSON.stringify({ ok: false, code: safeErrorCode(error) })); process.exitCode = 1; });
