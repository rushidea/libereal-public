import fs from 'fs';
import path from 'path';
import { LEGAL_DOCUMENT_SEEDS, type LegalDocumentPublic } from '@/data/legal-documents';
import { prisma } from '@/lib/prisma';

const LEGAL_DIR = path.join(process.cwd(), 'docs/legal');

export type LegalConsentContext = 'register' | 'checkout' | 'legal' | 'open-platform' | 'admin';

function toPublic(doc: {
  id: string;
  version: string;
  title: string;
  category: string;
  kind: string;
  description: string | null;
  sitePath: string | null;
  requireRegister: boolean;
  requireCheckout: boolean;
  showOnLegalPage: boolean;
  showOnOpenPlatform: boolean;
  sortOrder: number;
}): LegalDocumentPublic {
  const kind = doc.kind === 'site' ? 'site' : 'pdf';
  return {
    id: doc.id,
    version: doc.version,
    title: doc.title,
    category: doc.category,
    kind,
    description: doc.description,
    sitePath: doc.sitePath,
    downloadUrl: kind === 'pdf' ? `/api/legal/documents/${encodeURIComponent(doc.id)}/download` : doc.sitePath,
    requireRegister: doc.requireRegister,
    requireCheckout: doc.requireCheckout,
    showOnLegalPage: doc.showOnLegalPage,
    showOnOpenPlatform: doc.showOnOpenPlatform,
    sortOrder: doc.sortOrder,
  };
}

export async function ensureLegalDocumentsSeeded() {
  const count = await prisma.legalDocument.count();
  if (count > 0) return;

  await prisma.legalDocument.createMany({
    data: LEGAL_DOCUMENT_SEEDS.map((seed) => ({
      id: seed.id,
      version: seed.version,
      title: seed.title,
      category: seed.category,
      kind: seed.kind,
      fileName: seed.fileName ?? null,
      sitePath: seed.sitePath ?? null,
      description: seed.description,
      published: seed.published,
      requireRegister: seed.requireRegister,
      requireCheckout: seed.requireCheckout,
      showOnLegalPage: seed.showOnLegalPage,
      showOnOpenPlatform: seed.showOnOpenPlatform,
      sortOrder: seed.sortOrder,
    })),
  });
}

export async function listLegalDocuments(context: LegalConsentContext, includeUnpublished = false) {
  await ensureLegalDocumentsSeeded();

  const docs = await prisma.legalDocument.findMany({
    where: includeUnpublished ? {} : { published: true },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
  });

  const filtered = docs.filter((doc) => {
    if (includeUnpublished) return true;
    switch (context) {
      case 'register':
        return doc.requireRegister;
      case 'checkout':
        return doc.requireCheckout;
      case 'legal':
        return doc.showOnLegalPage;
      case 'open-platform':
        return doc.showOnOpenPlatform;
      case 'admin':
        return true;
      default:
        return true;
    }
  });

  return filtered.map(toPublic);
}

export async function listAllLegalDocumentsAdmin() {
  await ensureLegalDocumentsSeeded();
  const docs = await prisma.legalDocument.findMany({
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
  });
  return docs;
}

export async function updateLegalDocument(
  id: string,
  patch: Partial<{
    published: boolean;
    requireRegister: boolean;
    requireCheckout: boolean;
    showOnLegalPage: boolean;
    showOnOpenPlatform: boolean;
    sortOrder: number;
    description: string | null;
  }>,
) {
  return prisma.legalDocument.update({
    where: { id },
    data: patch,
  });
}

export async function getRequiredLegalDocumentIds(context: 'register' | 'checkout') {
  const consent = await getRequiredLegalConsent(context);
  return consent.requiredIds;
}

export type LegalAcceptanceSnapshot = {
  acceptedAt: string;
  documents: Array<{ id: string; version: string }>;
};

export async function getRequiredLegalConsent(
  context: 'register' | 'checkout',
  acceptedAt = new Date(),
) {
  const docs = await listLegalDocuments(context);
  return {
    requiredIds: docs.map((doc) => doc.id),
    snapshot: {
      acceptedAt: acceptedAt.toISOString(),
      documents: docs.map((doc) => ({ id: doc.id, version: doc.version })),
    } satisfies LegalAcceptanceSnapshot,
  };
}

export async function getRequiredLegalDocumentSnapshot(
  context: 'register' | 'checkout',
  acceptedAt = new Date(),
): Promise<LegalAcceptanceSnapshot> {
  const consent = await getRequiredLegalConsent(context, acceptedAt);
  return consent.snapshot;
}

export function validateAcceptedLegalIds(
  acceptedIds: unknown,
  requiredIds: string[],
): { ok: true } | { ok: false; missing: string[] } {
  if (!Array.isArray(acceptedIds)) {
    return { ok: false, missing: requiredIds };
  }
  const accepted = new Set(acceptedIds.filter((id): id is string => typeof id === 'string'));
  const missing = requiredIds.filter((id) => !accepted.has(id));
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

export async function resolveLegalPdfAbsolutePath(id: string): Promise<{ filePath: string; fileName: string } | null> {
  await ensureLegalDocumentsSeeded();
  const doc = await prisma.legalDocument.findUnique({ where: { id } });
  if (!doc || doc.kind !== 'pdf' || !doc.fileName) return null;

  const base = path.basename(doc.fileName);
  if (!/^[\w\u4e00-\u9fff\-]+$/.test(base)) return null;

  const filePath = path.join(LEGAL_DIR, `${base}.pdf`);
  if (!filePath.startsWith(LEGAL_DIR)) return null;
  if (!fs.existsSync(filePath)) return null;

  return { filePath, fileName: `${base}.pdf` };
}
