import { createHash } from 'node:crypto';

/** The attempt id is a client supplied correlation key, never a secret. */
export function validCheckoutAttemptId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function normalize(value: unknown, key?: string): unknown {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item));
    // Item order and legal-id order are presentation details of the request.
    if (key === 'items' || key === 'acceptedLegalIds') {
      return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .filter((name) => !['checkoutAttemptId', 'pricingRevision', 'checkoutRevision'].includes(name))
      .sort()
      .reduce<Record<string, unknown>>((out, name) => {
        out[name] = normalize((value as Record<string, unknown>)[name], name);
        return out;
      }, {});
  }
  return value;
}

const INTENT_FIELDS = [
  'items', 'paymentMethod', 'addressId', 'addressName', 'addressPhone', 'addressText', 'addressInstitution',
  'acceptedLegalIds', 'personalPoints', 'groupPoints', 'groupId', 'couponCode', 'organizationId',
  'name', 'email', 'phone', 'institution', 'department', 'address', 'notes', 'identity', 'advisorName', 'advisorPhone',
  'inquiryId', 'quoteId', 'quoteVersion', 'itemIndices', 'quantities',
];

function projectIntent(request: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of INTENT_FIELDS) {
    if (!(key in request)) continue;
    const value = request[key];
    if (key === 'items' && Array.isArray(value)) {
      projected.items = value.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const row = item as Record<string, unknown>;
        return Object.fromEntries(['productId', 'catalogNumber', 'variantId', 'spec', 'unit', 'quantity', 'promoMark', 'brand', 'name', 'isQuickOrder', 'customerLeadTime', 'actualLeadTime', 'leadTime'].filter((name) => name in row).map((name) => [name, row[name]]));
      });
    } else projected[key] = value;
  }
  return projected;
}

export function stableCheckoutJson(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? 'null';
}

export function buildCheckoutRequestFingerprint(input: {
  operation: 'order' | 'inquiry' | 'quote-confirmation';
  actorId: string | null;
  organizationId?: string | null;
  ownerScope?: string | null;
  request: Record<string, unknown>;
}): string {
  return createHash('sha256').update(stableCheckoutJson({
    version: 1,
    operation: input.operation,
    actorId: input.actorId,
    organizationId: input.organizationId ?? null,
    ownerScope: input.ownerScope ?? 'anonymous',
    request: projectIntent(input.request),
  })).digest('hex');
}

export function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
