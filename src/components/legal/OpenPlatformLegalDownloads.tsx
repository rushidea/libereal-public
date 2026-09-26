'use client';

import { useEffect, useState } from 'react';
import { LegalDocumentDownloads } from '@/components/legal/LegalConsentChecklist';
import type { LegalDocumentPublic } from '@/data/legal-documents';

export default function OpenPlatformLegalDownloads() {
  const [documents, setDocuments] = useState<LegalDocumentPublic[]>([]);

  useEffect(() => {
    fetch('/api/legal/documents?context=open-platform')
      .then((r) => r.json())
      .then((data) => setDocuments(Array.isArray(data.documents) ? data.documents : []))
      .catch(() => setDocuments([]));
  }, []);

  if (documents.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-3xl p-6 sm:p-8 shadow-xl shadow-black/5">
        <h2 className="text-xl font-bold text-gray-900 mb-1">入驻相关文书</h2>
        <p className="text-sm text-gray-500 mb-4">申请入驻前可下载下列协议与资质清单模板。</p>
        <LegalDocumentDownloads documents={documents} title="" compact />
      </div>
    </section>
  );
}
