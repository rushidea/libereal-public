const CHATWAY_SUPPRESSED_PATH_PREFIXES = ['/research/trends'];

export function shouldLoadChatway(pathname: string | null): boolean {
  if (pathname === null) return true;
  return !CHATWAY_SUPPRESSED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
