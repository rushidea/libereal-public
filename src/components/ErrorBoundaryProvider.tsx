'use client';

import { usePathname } from 'next/navigation';
import ErrorBoundary from './ErrorBoundary';
import { ReactNode } from 'react';

/**
 * Client-side wrapper that resets the ErrorBoundary on route change.
 * Without this, an error on /page-a would persist when navigating to /page-b.
 *
 * Pass an optional `fallback` to customize the error UI.
 */
export default function ErrorBoundaryProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <ErrorBoundary key={pathname} fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
}
