'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { shouldLoadChatway } from '@/lib/chatway-policy';

const FALLBACK_CHATWAY_WIDGET_ID = 'zhsfxQJxyphh';

export default function ChatwayWidget() {
  const pathname = usePathname();
  const widgetId =
    process.env.NEXT_PUBLIC_CHATWAY_WIDGET_ID || FALLBACK_CHATWAY_WIDGET_ID;

  if (!shouldLoadChatway(pathname)) return null;

  return (
    <Script
      id="chatway"
      src={`https://cdn.chatway.app/widget.js?id=${encodeURIComponent(widgetId)}`}
      strategy="afterInteractive"
    />
  );
}
