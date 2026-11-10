// Invoked only by the existing restricted SSH service account and its fixed host wrapper.
import { handleEngineeringBridge } from '../src/lib/ai-ops/engineering-bridge';
import { safeErrorCode } from '../src/lib/ai-ops/bridge-protocol';
import { prisma } from '../src/lib/prisma';

async function main() {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const data = Buffer.from(chunk); bytes += data.length;
    if (bytes > 65_536) throw new Error('aiops_bridge_invalid');
    chunks.push(data);
  }
  const result = await handleEngineeringBridge(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
main().catch((error: unknown) => { process.stdout.write(`${JSON.stringify({ ok: false, code: safeErrorCode(error) })}\n`); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
