import { prisma } from '@/lib/prisma';
import { CALL_RESERVATION_NANOUSD, type AiOpsPolicy } from './policy';
import { createBudgetedModelClient, sendOpenAiResponse, sha256, type BudgetLedger } from './model-client-core';
export * from './model-client-core';

type LedgerState = { version: 1; scope: string; limit: number; consumed: number };
function ledgerState(payload: string, policy: AiOpsPolicy): LedgerState {
  const state = JSON.parse(payload) as LedgerState;
  if (state.version !== 1 || state.scope !== policy.budgetScope || state.limit !== policy.maxBudgetNanousd || !Number.isSafeInteger(state.consumed) || state.consumed < 0 || state.consumed > state.limit) throw new Error('aiops_budget_state_invalid');
  return state;
}
const budgetId = (policy: AiOpsPolicy) => `aiops-budget-${sha256(policy.budgetScope)}`;
export const persistentBudgetLedger: BudgetLedger = {
  async reserve(policy, call) {
    await prisma.$transaction(async (tx) => {
      const id = budgetId(policy);
      let row = await tx.backgroundTask.findUnique({ where: { id } });
      if (!row) row = await tx.backgroundTask.create({ data: { id, type: 'aiops.control.budget', status: 'succeeded', maxAttempts: 1,
        payload: JSON.stringify({ version: 1, scope: policy.budgetScope, limit: policy.maxBudgetNanousd, consumed: 0 }), completedAt: new Date() } });
      if (row.type !== 'aiops.control.budget' || row.status !== 'succeeded') throw new Error('aiops_budget_state_invalid');
      const state = ledgerState(row.payload, policy);
      if (state.consumed + CALL_RESERVATION_NANOUSD > state.limit) throw new Error('aiops_budget_exhausted');
      const changed = await tx.backgroundTask.updateMany({ where: { id, payload: row.payload }, data: { payload: JSON.stringify({ ...state, consumed: state.consumed + CALL_RESERVATION_NANOUSD }) } });
      if (changed.count !== 1) throw new Error('aiops_budget_conflict');
      await tx.backgroundTask.create({ data: { id: call.id, type: 'aiops.control.call', status: 'succeeded', maxAttempts: 1,
        payload: JSON.stringify({ version: 1, scope: policy.budgetScope, ...call, callStarted: true, reservationNanousd: CALL_RESERVATION_NANOUSD, settlement: 'unknown' }), completedAt: new Date() } });
    });
  },
  async settle(policy, callId, result) {
    await prisma.$transaction(async (tx) => {
      const call = await tx.backgroundTask.findUnique({ where: { id: callId } });
      if (!call || call.type !== 'aiops.control.call') throw new Error('aiops_budget_call_missing');
      const started = JSON.parse(call.payload) as { scope?: string; settlement?: string };
      if (started.scope !== policy.budgetScope || started.settlement !== 'unknown') throw new Error('aiops_budget_call_invalid');
      const id = budgetId(policy);
      const row = await tx.backgroundTask.findUnique({ where: { id } });
      if (!row) throw new Error('aiops_budget_state_invalid');
      const state = ledgerState(row.payload, policy);
      if (state.consumed < CALL_RESERVATION_NANOUSD || !Number.isSafeInteger(result.estimatedUpperNanousd) || result.estimatedUpperNanousd < 0 || result.estimatedUpperNanousd > CALL_RESERVATION_NANOUSD) throw new Error('aiops_budget_settlement_invalid');
      const changed = await tx.backgroundTask.updateMany({ where: { id, payload: row.payload }, data: { payload: JSON.stringify({ ...state, consumed: state.consumed - CALL_RESERVATION_NANOUSD + result.estimatedUpperNanousd }) } });
      if (changed.count !== 1) throw new Error('aiops_budget_conflict');
      await tx.backgroundTask.update({ where: { id: callId }, data: { payload: JSON.stringify({ ...started, settlement: 'usage_upper_estimate' }), result: JSON.stringify(result) } });
    });
  },
};

export const callAiOpsModel = createBudgetedModelClient({ ledger: persistentBudgetLedger, transport: sendOpenAiResponse, key: () => process.env.OPENAI_API_KEY });
