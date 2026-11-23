import { canAccessOrganizationRecord } from '@/lib/organization-record-access';
import { requireOrganizationPermission } from '@/lib/organization-service';
import { emailKeyedAccess } from '@/lib/verified-email-access';

export async function customerCanReadOrder(userId: string, order: { ownerScope: string; organizationId: string | null; customerId: string | null; email: string }) {
  if (order.ownerScope !== 'organization') return order.customerId === userId || emailKeyedAccess(userId, order.email);
  if (!order.organizationId) return false;
  if (await canAccessOrganizationRecord(userId, order.organizationId)) return true;
  if (order.customerId !== userId) return false;
  try {
    await requireOrganizationPermission(userId, order.organizationId, 'organization.orders.create');
    return true;
  } catch { return false; }
}
