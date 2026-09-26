/**
 * Centralized error reporting.
 *
 * Default: console.error (works in dev and prod)
 * Production: also reports to Sentry if SENTRY_DSN env var is set
 *
 * To enable Sentry:
 *   1. Sign up at https://sentry.io (free tier: 5K events/month)
 *   2. Create a Next.js project, copy the DSN
 *   3. Add to .env: SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
 *   4. Install: npm install @sentry/nextjs
 *   5. Add sentry.client.config.ts and sentry.server.config.ts files
 *
 * Until then, errors are logged to console only.
 */

interface ErrorContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string };
}

function shouldReport(): boolean {
  return process.env.NODE_ENV === 'production' && !!process.env.SENTRY_DSN;
}

function formatError(err: unknown): { message: string; stack?: string; name?: string; raw?: unknown } {
  if (err instanceof Error) {
    const extra = err as Error & { digest?: string; cause?: unknown };
    const message =
      extra.message ||
      extra.digest ||
      (extra.cause instanceof Error ? extra.cause.message : undefined) ||
      extra.name ||
      'Unknown error';
    return { message, stack: extra.stack, name: extra.name };
  }
  if (typeof err === 'string') {
    return { message: err };
  }
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const message =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.digest === 'string' && record.digest) ||
      JSON.stringify(err);
    return { message, raw: err };
  }
  return { message: String(err) };
}

export function reportError(err: unknown, context: ErrorContext = {}): void {
  // Always log to console (for dev + log aggregation)
  const formatted = formatError(err);
  console.error('[error]', {
    ...formatted,
    ...context,
  });

  // Sentry integration (lazy-loaded to avoid bundle bloat when not configured)
  if (shouldReport() && typeof globalThis !== 'undefined') {
    // Use Function constructor to bypass static analysis (avoids build error
    // when @sentry/nextjs is not installed). @sentry/nextjs is an optional
    // peer dependency — install only when SENTRY_DSN is configured.
    try {
      const dynamicRequire = new Function('m', 'return require(m)') as (m: string) => unknown;
      const SentryModule = (globalThis as unknown as { __SENTRY__?: unknown }).__SENTRY__ 
        || dynamicRequire('@sentry/nextjs');
      const Sentry = SentryModule as {
        captureException: (err: unknown, ctx: { tags?: Record<string, string>; extra?: Record<string, unknown>; user?: { id?: string; email?: string } }) => void;
        captureMessage: (msg: string, ctx: { level?: string; tags?: Record<string, string>; extra?: Record<string, unknown> }) => void;
      };
      Sentry.captureException(err, {
        tags: context.tags,
        extra: context.extra,
        user: context.user,
      });
    } catch {
      // Sentry not installed — silent fallback to console
    }
  }
}

export function reportMessage(message: string, context: ErrorContext = {}): void {
  console.warn('[warn]', { message, ...context });
  if (shouldReport() && typeof globalThis !== 'undefined') {
    try {
      const dynamicRequire = new Function('m', 'return require(m)') as (m: string) => unknown;
      const SentryModule = (globalThis as unknown as { __SENTRY__?: unknown }).__SENTRY__
        || dynamicRequire('@sentry/nextjs');
      const Sentry = SentryModule as {
        captureException: (err: unknown, ctx: { tags?: Record<string, string>; extra?: Record<string, unknown>; user?: { id?: string; email?: string } }) => void;
        captureMessage: (msg: string, ctx: { level?: string; tags?: Record<string, string>; extra?: Record<string, unknown> }) => void;
      };
      Sentry.captureMessage(message, {
        level: 'warning',
        tags: context.tags,
        extra: context.extra,
      });
    } catch {
      // Sentry not installed
    }
  }
}
