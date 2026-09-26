'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import ProtocolCard from '@/components/ProtocolCard';
import BufferCard from '@/components/BufferCard';
import type { Protocol } from '@/data/protocols-detail';
import type { BufferDetail } from '@/data/buffers-detail';
import type { ProtocolSummary } from '@/data/protocols-summary';
import type { BufferSummary } from '@/data/buffers-summary';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface ProtocolDetailModalProps {
  item: ProtocolSummary | BufferSummary;
  isProtocol: boolean;
  detailData: Protocol | BufferDetail | null;
  isLoading: boolean;
  onClose: () => void;
}

export default function ProtocolDetailModal({
  item,
  isProtocol,
  detailData,
  isLoading,
  onClose,
}: ProtocolDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="fixed inset-0 z-site-overlay flex flex-col">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${uiSurfaces.modalBackdrop}`}
        onClick={onClose}
      />

      {/* Modal - positioned below fixed header */}
      <div
        ref={modalRef}
        className={`relative w-full max-w-4xl mt-[67px] md:mt-[112px] mx-auto mb-4 max-h-[calc(100vh-67px-32px)] md:max-h-[calc(100vh-112px-32px)] overflow-y-auto rounded-[var(--brand-border-radius)] ${uiSurfaces.modal}`}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 z-10 rounded-[var(--brand-border-radius-pill)] bg-[var(--brand-color-bg-muted)] p-2 text-[var(--brand-color-text-secondary)] transition-colors hover:bg-[var(--brand-color-bg-hover)] ${uiSurfaces.focusRing}`}
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        {isProtocol ? (
          <ProtocolCard
            protocol={item as ProtocolSummary}
            isExpanded={true}
            isHeaderOnly={false}
            isLoading={isLoading}
            detailData={detailData as Protocol | null}
            onToggle={onClose}
          />
        ) : (
          <BufferCard
            buffer={item as BufferSummary}
            isExpanded={true}
            isHeaderOnly={false}
            isLoading={isLoading}
            detailData={detailData as BufferDetail | null}
            onToggle={onClose}
          />
        )}
      </div>
    </div>
  );
}
