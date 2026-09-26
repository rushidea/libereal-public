import Link from 'next/link';
import type { ReactNode } from 'react';

type SceneHashLinkProps = {
  href: string;
  className?: string;
  children: ReactNode;
};

/** Same-page hash links use native `<a>` so scroll-margin anchors work reliably. */
export default function SceneHashLink({ href, className, children }: SceneHashLinkProps) {
  if (href.startsWith('#')) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
