import { NextRequest } from 'next/server';
import { handleHarnessInquiryPost } from '@/lib/harness-tools/route-helpers';
import {
  claimInquiryLeaseForHarness,
  type ClaimInquiryLeaseInput,
} from '@/lib/harness-tools/lease-service';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleHarnessInquiryPost(req, context, {
    tool: 'claim_inquiry_lease',
    requiredScope: 'inquiry.lease',
    allowEmptyBody: false,
    run: (inquiryId, body, principal) =>
      claimInquiryLeaseForHarness(
        inquiryId,
        body as unknown as ClaimInquiryLeaseInput,
        principal,
      ),
  });
}
