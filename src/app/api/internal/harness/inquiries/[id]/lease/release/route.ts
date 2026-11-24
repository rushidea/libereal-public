import { NextRequest } from 'next/server';
import { handleHarnessInquiryPost } from '@/lib/harness-tools/route-helpers';
import {
  releaseInquiryLeaseForHarness,
  type ReleaseInquiryLeaseInput,
} from '@/lib/harness-tools/lease-service';

const LEASE_RELEASE_BODY_FIELDS = new Set(['leaseToken', 'fenceToken']);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleHarnessInquiryPost(req, context, {
    tool: 'release_inquiry_lease',
    requiredScope: 'inquiry.lease',
    allowEmptyBody: false,
    allowBodyFields: LEASE_RELEASE_BODY_FIELDS,
    run: (inquiryId, body, principal) =>
      releaseInquiryLeaseForHarness(
        inquiryId,
        body as unknown as ReleaseInquiryLeaseInput,
        principal,
      ),
  });
}
