'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { shouldLoadKnocket } from '@/lib/knocket-policy';

const KNOCKET_SDK_VERSION = '1792006311077';

export default function KnocketWidget() {
  const pathname = usePathname();
  const identifier = process.env.NEXT_PUBLIC_KNOCKET_IDENTIFIER?.trim();

  if (!identifier || !shouldLoadKnocket(pathname)) return null;

  return (
    <Script
      id="knocket"
      src={`https://trtc.io/knocket-sdk/sdk.js?identifier=${encodeURIComponent(identifier)}&v=${KNOCKET_SDK_VERSION}`}
      strategy="lazyOnload"
    />
  );
}
