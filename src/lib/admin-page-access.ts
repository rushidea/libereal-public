export function canViewAdminPages(role: unknown): boolean {
  return role === 'admin';
}

export function isAdminAppPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export function shouldHideAdminFromAnonymous(pathname: string, hasSessionCookie: boolean): boolean {
  return isAdminAppPath(pathname) && !hasSessionCookie;
}
