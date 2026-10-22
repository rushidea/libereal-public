'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

/** Inquiry ids are `id_` plus a UUID. Other prefixes (orders, quotes, users) are left as plain text. */
const INQUIRY_ID_SOURCE = 'id_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export type InquiryIdTextPart = { type: 'text' | 'id'; value: string };

export function splitInquiryIdText(text: string): InquiryIdTextPart[] {
  const pattern = new RegExp(INQUIRY_ID_SOURCE, 'gi');
  const parts: InquiryIdTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: 'text', value: text.slice(last, index) });
    parts.push({ type: 'id', value: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length || parts.length === 0) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/** Keep the `id_` prefix plus 8 hex chars, and the last 6 chars. Example: id_68011acc…111111 */
const ABBREV_PREFIX = 11;
const ABBREV_SUFFIX = 6;

export function abbreviateInquiryId(id: string): string {
  if (id.length <= ABBREV_PREFIX + ABBREV_SUFFIX + 1) return id;
  return `${id.slice(0, ABBREV_PREFIX)}…${id.slice(-ABBREV_SUFFIX)}`;
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function InquiryIdDisplay({
  id,
  className = '',
  size = 'default',
}: {
  id: string;
  className?: string;
  size?: 'default' | 'compact';
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const abbreviated = abbreviateInquiryId(id);
  const canAbbreviate = abbreviated !== id;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function stopRowToggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function onCopy(event: MouseEvent<HTMLButtonElement>) {
    stopRowToggle(event);
    const ok = await writeClipboard(id);
    if (ok) setCopied(true);
  }

  function onToggle(event: MouseEvent<HTMLButtonElement>) {
    stopRowToggle(event);
    setExpanded((open) => !open);
  }

  const sizeClass = size === 'compact' ? 'text-xs' : 'text-sm';
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <span data-inquiry-id={id} className={`inline-flex max-w-full min-w-0 items-start gap-1 align-top ${className}`}>
      <span className={`${canAbbreviate ? 'hidden lg:inline' : ''} min-w-0 break-all font-mono leading-5 ${sizeClass}`}>{id}</span>
      {canAbbreviate ? (
        <button
          type="button"
          data-inquiry-id-toggle=""
          aria-expanded={expanded}
          aria-label={expanded ? `收起询价编号 ${id}` : `展开询价编号 ${id}`}
          onClick={onToggle}
          className={`inline-flex max-w-full min-w-0 items-start gap-0.5 rounded-[var(--brand-border-radius)] border border-dashed border-[var(--brand-color-text-interactive)] bg-[var(--brand-color-bg-container)] px-1.5 py-0.5 text-left leading-5 lg:hidden ${sizeClass} ${uiSurfaces.focusRing}`}
        >
          <span className={`min-w-0 font-mono ${expanded ? 'break-all' : 'whitespace-nowrap'}`}>{expanded ? id : abbreviated}</span>
          <Chevron className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand-color-text-interactive)]" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onCopy}
        className={`mt-px inline-flex min-h-7 shrink-0 items-center gap-1 rounded-[var(--brand-border-radius)] border border-[var(--brand-color-border)] bg-[var(--brand-color-bg-container)] px-1.5 text-[11px] leading-none text-[var(--brand-color-text-secondary)] hover:text-[var(--brand-color-text-interactive)] ${uiSurfaces.focusRing}`}
        aria-label={copied ? '已复制' : '复制询价编号'}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        <span aria-live="polite" className={copied ? 'font-medium text-[var(--brand-color-text)]' : 'sr-only'}>
          {copied ? '已复制' : '复制'}
        </span>
      </button>
    </span>
  );
}

export function InquiryIdText({
  text,
  className = '',
  as: Tag = 'span',
}: {
  text: string;
  className?: string;
  as?: 'span' | 'p' | 'div';
}) {
  const parts = splitInquiryIdText(text);
  return (
    <Tag className={`min-w-0 break-words ${className}`}>
      {parts.map((part, index) =>
        part.type === 'id' ? (
          <InquiryIdDisplay key={`${part.value}-${index}`} id={part.value} size="compact" />
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </Tag>
  );
}
