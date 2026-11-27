import { prisma } from '@/lib/prisma';
import type { ModelUsage } from './model-client-core';
import { validateSettlement } from './bridge-protocol';
export type ModelAccounting = {
  calls: number; usage: ModelUsage; estimatedUpperNanousd: number; unknownReservedNanousd: number;
  records: Array<{ stage: string; startedAt: string; settlement: 'unknown' | 'usage_upper_estimate'; reservationNanousd: number; estimatedUpperNanousd?: number; usage?: ModelUsage; responseId?: string; inputHash: string; outputHash?: string }>;
};
export async function taskModelAccounting(taskId: string): Promise<ModelAccounting> {
  const rows = await prisma.backgroundTask.findMany({ where: { type: 'aiops.control.call', payload: { contains: `"taskId":${JSON.stringify(taskId)}` } }, orderBy: { createdAt: 'asc' }, take: 20 });
  const result: ModelAccounting = { calls: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, estimatedUpperNanousd: 0, unknownReservedNanousd: 0, records: [] };
  for (const row of rows) {
    try {
      const p = JSON.parse(row.payload) as { taskId: string; stage: string; startedAt: string; reservationNanousd: number; inputHash: string; settlement: string };
      if (p.taskId !== taskId || p.reservationNanousd !== 700_000_000 || !/^(?:supervisor|business:[a-z_]+|architecture|coding|review)$/.test(p.stage) || !/^[a-f0-9]{64}$/.test(p.inputHash) || typeof p.startedAt !== 'string' || p.startedAt.length > 32 || !Number.isFinite(Date.parse(p.startedAt))) continue;
      result.calls++; result.unknownReservedNanousd += p.reservationNanousd;
      const record: ModelAccounting['records'][number] = { stage: p.stage, startedAt: p.startedAt, reservationNanousd: p.reservationNanousd, inputHash: p.inputHash, settlement: 'unknown' };
      if (p.settlement === 'usage_upper_estimate' && row.result) {
        const settled: unknown = JSON.parse(row.result); validateSettlement(settled);
        if (settled.inputHash !== p.inputHash) throw new Error();
        record.settlement = 'usage_upper_estimate'; record.estimatedUpperNanousd = settled.estimatedUpperNanousd; record.usage = settled.usage; record.responseId = settled.responseId; record.outputHash = settled.outputHash;
        result.estimatedUpperNanousd += settled.estimatedUpperNanousd; result.unknownReservedNanousd -= p.reservationNanousd;
        for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) result.usage[key] += settled.usage[key];
      }
      result.records.push(record);
    } catch { /* Malformed records never become usage or a refund claim. */ }
  }
  return result;
}
