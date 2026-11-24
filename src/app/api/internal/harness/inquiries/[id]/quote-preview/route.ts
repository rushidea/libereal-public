import { NextRequest } from 'next/server';
import {
  previewInquiryQuoteForHarness,
  type PreviewLineOverrideInput,
} from '@/lib/harness-tools/inquiry-tools-service';
import { handleHarnessInquiryPost } from '@/lib/harness-tools/route-helpers';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleHarnessInquiryPost(req, context, {
    tool: 'preview_inquiry_quote',
    requiredScope: 'inquiry.quote.preview',
    allowEmptyBody: true,
    run: (inquiryId, body) =>
      previewInquiryQuoteForHarness(inquiryId, {
        ...(body.lineOverrides !== undefined
          ? { lineOverrides: body.lineOverrides as PreviewLineOverrideInput[] }
          : {}),
      }),
  });
}
