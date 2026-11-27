import { createHash } from 'node:crypto';

export function supplierPaymentProof(reference: string, payee: string | null | undefined, occurredAt = new Date().toISOString()) {
  return { payee: payee ?? '', bankTrace: reference, occurredAt,
    referenceSha256: createHash('sha256').update('synthetic bank receipt ' + reference).digest('hex') };
}
