import { NextRequest } from 'next/server';
import { getSupplierQuoteEvidenceForHarness } from '@/lib/harness-tools/inquiry-tools-service';
import { handleHarnessInquiryGet } from '@/lib/harness-tools/route-helpers';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleHarnessInquiryGet(req, context, {
    tool: 'get_supplier_quote_evidence',
    requiredScope: 'inquiry.read',
    run: (inquiryId) => getSupplierQuoteEvidenceForHarness(inquiryId),
  });
}
