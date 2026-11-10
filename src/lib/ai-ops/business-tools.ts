import type { AdminPermissionKey } from '@/lib/admin-permissions';
import { prisma } from '@/lib/prisma';

export const BUSINESS_WORKERS = ['catalog', 'promotion', 'customer_sales', 'order_fulfillment', 'logistics', 'content_search', 'risk_data'] as const;
export type BusinessWorker = typeof BUSINESS_WORKERS[number];
export const WORKER_PERMISSIONS: Record<BusinessWorker, readonly AdminPermissionKey[]> = {
  catalog: ['products.read'], promotion: ['pricing.read'], customer_sales: ['inquiries.read'],
  order_fulfillment: ['orders.read'], logistics: ['orders.read'], content_search: ['content.read'], risk_data: ['audit.read'],
};
export function isBusinessWorker(value: unknown): value is BusinessWorker { return BUSINESS_WORKERS.includes(value as BusinessWorker); }
export function requireWorkerPermissions(worker: BusinessWorker, permissions: readonly string[]) {
  if (!WORKER_PERMISSIONS[worker].every((p) => permissions.includes(p))) throw new Error('aiops_domain_forbidden');
}
export type BusinessSnapshot = { version: 1; workerId: BusinessWorker; asOf: string; source: string; facts: unknown };

// These queries are the complete tool allowlist. User/model text cannot select a table,
// field, filter, SQL statement, write operation or outbound communication.
export async function readBusinessSnapshot(worker: BusinessWorker, permissions: readonly string[], db = prisma): Promise<BusinessSnapshot> {
  requireWorkerPermissions(worker, permissions);
  let facts: unknown;
  let source: string;
  switch (worker) {
    case 'catalog':
      source = 'Product/public-catalog-projection';
      facts = { total: await db.product.count(), sample: await db.product.findMany({
        select: { name: true, brand: true, catalogNumber: true, category: true, inStock: true },
        orderBy: { updatedAt: 'desc' }, take: 12,
      }) };
      break;
    case 'promotion':
      source = 'Promotion/status-counts';
      facts = await db.promotion.groupBy({ by: ['status'], _count: { _all: true } });
      break;
    case 'customer_sales':
      source = 'Inquiry/status-counts';
      facts = await db.inquiry.groupBy({ by: ['status'], _count: { _all: true } });
      break;
    case 'order_fulfillment':
      source = 'Order/status-counts';
      facts = await db.order.groupBy({ by: ['status'], _count: { _all: true } });
      break;
    case 'logistics':
      source = 'Shipment/status-counts';
      facts = await db.shipment.groupBy({ by: ['status'], _count: { _all: true } });
      break;
    case 'content_search':
      source = 'LegalDocument/published-public-metadata';
      facts = await db.legalDocument.findMany({ where: { published: true }, select: { title: true, category: true, sitePath: true, version: true }, orderBy: { sortOrder: 'asc' }, take: 20 });
      break;
    case 'risk_data':
      source = 'AuditLog/recent-event-count';
      facts = { last24Hours: await db.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }) };
      break;
  }
  // Explicit reconstruction prevents an accidentally extended/mock row from leaking fields.
  if (worker === 'catalog') {
    const f = facts as { total: number; sample: Array<{ name: string; brand: string; catalogNumber: string; category: string | null; inStock: boolean }> };
    facts = { total: f.total, sample: f.sample.map((p) => ({ name: p.name, brand: p.brand, catalogNumber: p.catalogNumber, category: p.category, inStock: p.inStock })) };
  } else if (worker === 'content_search') {
    facts = (facts as Array<{ title: string; category: string; sitePath: string | null; version: string }>).map((p) => ({ title: p.title, category: p.category, sitePath: p.sitePath, version: p.version }));
  } else if (worker !== 'risk_data') {
    facts = (facts as Array<{ status: string; _count: { _all: number } }>).map((p) => ({ status: p.status, count: p._count._all }));
  }
  return { version: 1, workerId: worker, asOf: new Date().toISOString(), source, facts };
}
