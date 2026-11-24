import { NextRequest } from 'next/server';
import {
  prepareSupplierQuoteReviewForHarness,
  type PrepareSupplierReviewInput,
} from '@/lib/harness-tools/inquiry-tools-service';
import { handleHarnessInquiryPost } from '@/lib/harness-tools/route-helpers';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleHarnessInquiryPost(req, context, {
    tool: 'prepare_supplier_quote_review',
    requiredScope: 'inquiry.supplier_review.prepare',
    allowEmptyBody: false,
    run: (inquiryId, body, principal) =>
      prepareSupplierQuoteReviewForHarness(
        inquiryId,
        body as unknown as PrepareSupplierReviewInput,
        principal,
      ),
  });
}
