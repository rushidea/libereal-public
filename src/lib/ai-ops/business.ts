import { prisma } from '@/lib/prisma';
import { getAdminPermissions } from '@/lib/admin-user-permissions';
import { resolveSessionRole } from '@/lib/auth-helpers';
import { getSecuritySessionState } from '@/lib/security/security-session-service';
import type { AiOpsActor } from './contracts';
export async function revalidateAiOpsActor(actor: AiOpsActor) {
  const [user, session] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, email: true, role: true, isBlacklisted: true, isFrozen: true, approvalStatus: true } }),
    getSecuritySessionState(actor.id, actor.sessionId),
  ]);
  if (!user || !session.known || !session.active || user.isBlacklisted || user.isFrozen || user.approvalStatus !== 'approved' || resolveSessionRole(user.role, user.email) !== 'admin') throw new Error('aiops_actor_inactive');
  const permissions = await getAdminPermissions({ id: user.id, email: user.email, role: 'admin' });
  if (!permissions.includes('admin.access')) throw new Error('aiops_actor_forbidden');
  return { id: actor.id, sessionId: actor.sessionId, permissions };
}


// Compatibility guard for old callers: no website model execution.
export async function routeAiOpsRequest(input: { actor: AiOpsActor; [key: string]: unknown }): Promise<never> {
  await revalidateAiOpsActor(input.actor);
  throw new Error('aiops_native_runner_required');
}
