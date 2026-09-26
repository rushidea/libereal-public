import { describe, expect, it } from 'vitest';
import {
  canViewAdminPages,
  isAdminAppPath,
  shouldHideAdminFromAnonymous,
} from '@/lib/admin-page-access';

describe('admin page access', () => {
  it('allows only the administrator role', () => {
    expect(canViewAdminPages('admin')).toBe(true);
    expect(canViewAdminPages('customer')).toBe(false);
    expect(canViewAdminPages(undefined)).toBe(false);
    expect(canViewAdminPages(null)).toBe(false);
  });

  it('matches app admin paths without treating similar prefixes as admin', () => {
    expect(isAdminAppPath('/admin')).toBe(true);
    expect(isAdminAppPath('/admin/orders')).toBe(true);
    expect(isAdminAppPath('/administrator')).toBe(false);
    expect(isAdminAppPath('/account')).toBe(false);
  });

  it('hides admin app routes when there is no session cookie', () => {
    expect(shouldHideAdminFromAnonymous('/admin', false)).toBe(true);
    expect(shouldHideAdminFromAnonymous('/admin/access', false)).toBe(true);
    expect(shouldHideAdminFromAnonymous('/admin', true)).toBe(false);
    expect(shouldHideAdminFromAnonymous('/products', false)).toBe(false);
  });
});
