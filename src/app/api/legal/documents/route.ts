import { NextRequest, NextResponse } from 'next/server';
import { listLegalDocuments, type LegalConsentContext } from '@/lib/legal-documents';

const CONTEXTS = new Set<LegalConsentContext>(['register', 'checkout', 'legal', 'open-platform']);

export async function GET(req: NextRequest) {
  const context = (req.nextUrl.searchParams.get('context') ?? 'legal') as LegalConsentContext;
  if (!CONTEXTS.has(context)) {
    return NextResponse.json({ error: 'Invalid context' }, { status: 400 });
  }

  const documents = await listLegalDocuments(context);
  return NextResponse.json({ documents });
}
