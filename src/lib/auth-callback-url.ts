const MAX_CALLBACK_LENGTH = 512;

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Accept only same-site relative paths. Protocol-relative (`//host`) and
 * absolute URLs are rejected so login cannot be used as an open redirect.
 */
export function sanitizeAuthCallbackUrl(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CALLBACK_LENGTH) return fallback;
  const candidate = decodeOnce(trimmed);
  if (!candidate || candidate.length > MAX_CALLBACK_LENGTH) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;
  if (candidate.includes('\\') || candidate.includes('://') || /[\u0000-\u001f\u007f\s]/.test(candidate)) return fallback;
  return candidate;
}

export function isAuthEntryPath(pathname: string): boolean {
  return pathname === '/login'
    || pathname === '/register'
    || pathname.startsWith('/login/')
    || pathname.startsWith('/register/');
}

/** Pull a safe return path out of an Auth.js callback cookie or redirect URL. */
export function callbackPathFromAuthUrl(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const raw = decodeOnce(value.trim());
  if (!raw) return undefined;

  let pathname = '';
  let search = '';
  let hash = '';
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = new URL(raw);
      pathname = url.pathname;
      search = url.search;
      hash = url.hash;
    } else if (raw.startsWith('/')) {
      const url = new URL(raw, 'http://local');
      pathname = url.pathname;
      search = url.search;
      hash = url.hash;
    } else {
      return undefined;
    }
  } catch {
    return undefined;
  }

  if (isAuthEntryPath(pathname)) {
    const nested = sanitizeAuthCallbackUrl(new URLSearchParams(search).get('callbackUrl'), '');
    return nested || undefined;
  }

  const safe = sanitizeAuthCallbackUrl(`${pathname}${search}${hash}`, '');
  return safe || undefined;
}

export function withAuthCallback(path: string, callbackUrl: string | null | undefined): string {
  const safe = sanitizeAuthCallbackUrl(callbackUrl, '');
  if (!safe) return path;
  const url = new URL(path, 'http://local');
  url.searchParams.set('callbackUrl', safe);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Keep the current page's return path on a post-login redirect such as MFA. */
export function appendAuthCallbackUrl(target: string, callbackUrl: string | null | undefined): string {
  const safe = sanitizeAuthCallbackUrl(callbackUrl, '');
  if (!safe || !target) return target;
  try {
    const url = new URL(target, 'http://local');
    url.searchParams.set('callbackUrl', safe);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return target;
  }
}
