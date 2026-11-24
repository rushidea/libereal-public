import { NextRequest } from 'next/server';
import { getInquiryContextForHarness } from '@/lib/harness-tools/inquiry-tools-service';
import { handleHarnessInquiryGet } from '@/lib/harness-tools/route-helpers';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleHarnessInquiryGet(req, context, {
    tool: 'get_inquiry_context',
    requiredScope: 'inquiry.read',
    run: (inquiryId) => getInquiryContextForHarness(inquiryId),
  });
}
