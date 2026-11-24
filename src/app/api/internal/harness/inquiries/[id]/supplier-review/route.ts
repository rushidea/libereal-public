import { NextRequest } from 'next/server';
import { extractHarnessLeaseHeaders } from '@/lib/harness-tools/auth';
import {
  prepareSupplierQuoteReviewForHarness,
  type PrepareSupplierReviewInput,
} from '@/lib/harness-tools/inquiry-tools-service';
import { handleHarnessInquiryPost } from '@/lib/harness-tools/route-helpers';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const leaseHeaderResult = extractHarnessLeaseHeaders(req);
  if (leaseHeaderResult.provided && !leaseHeaderResult.ok) {
    return leaseHeaderResult.response;
  }
  const lease = leaseHeaderResult.provided ? leaseHeaderResult.lease : null;

  return handleHarnessInquiryPost(req, context, {
    tool: 'prepare_supplier_quote_review',
    requiredScope: 'inquiry.supplier_review.prepare',
    allowEmptyBody: false,
    run: (inquiryId, body, principal) =>
      prepareSupplierQuoteReviewForHarness(
        inquiryId,
        body as unknown as PrepareSupplierReviewInput,
        principal,
        lease,
      ),
  });
}
