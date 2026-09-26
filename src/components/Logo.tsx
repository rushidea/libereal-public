'use client';

import Image from 'next/image';

export default function Logo({ className = '' }: { className?: string }) {
  return (
    <Image
      src="/footer-logo.png"
      alt="LIBEREAL logo"
      className={className}
      width={120}
      height={40}
      suppressHydrationWarning
    />
  );
}
