const KNOCKET_SUPPRESSED_PATH_PREFIXES = ['/research/trends'];

export function shouldLoadKnocket(pathname: string | null): boolean {
  if (pathname === null) return true;
  return !KNOCKET_SUPPRESSED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
