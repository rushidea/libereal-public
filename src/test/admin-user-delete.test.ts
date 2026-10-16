import { describe, expect, it } from 'vitest';
import {
  ADMIN_USER_DELETE_BATCH_LIMIT,
  ADMIN_USER_DELETE_ERRORS,
  adminUserDeleteBlockMessage,
  parseAdminUserDeleteIds,
} from '@/data/admin-user-delete';
import {
  filterAdminUsersBySearch,
  retainVisibleSelection,
  visibleSelectedUserIds,
} from '@/data/admin-user-list';

const users = [
  { id: 'a', name: '甲老师', email: 'jia@example.com', institution: '甲大学' },
  { id: 'b', name: '乙老师', email: 'yi@example.com', institution: '乙医院' },
  { id: 'c', name: '丙', email: 'bing@lab.test', piLab: '甲实验室' },
];

describe('admin user delete guards', () => {
  it('rejects empty, oversized, and non-string ids', () => {
    expect(parseAdminUserDeleteIds(undefined)).toEqual({ error: ADMIN_USER_DELETE_ERRORS.empty });
    expect(parseAdminUserDeleteIds([])).toEqual({ error: ADMIN_USER_DELETE_ERRORS.empty });
    expect(parseAdminUserDeleteIds(['ok', 1])).toEqual({ error: ADMIN_USER_DELETE_ERRORS.invalidId });
    expect(parseAdminUserDeleteIds(['   '])).toEqual({ error: ADMIN_USER_DELETE_ERRORS.invalidId });
    expect(parseAdminUserDeleteIds(['x'.repeat(129)])).toEqual({ error: ADMIN_USER_DELETE_ERRORS.invalidId });
    expect(parseAdminUserDeleteIds(Array.from({ length: ADMIN_USER_DELETE_BATCH_LIMIT + 1 }, (_, index) => `u_${index}`)))
      .toEqual({ error: ADMIN_USER_DELETE_ERRORS.tooMany });
  });

  it('dedupes ids and blocks admin, self, and organization owners as a whole batch', () => {
    expect(parseAdminUserDeleteIds([' u_1 ', 'u_1', 'u_2'])).toEqual({ ids: ['u_1', 'u_2'] });

    const targets = [
      { id: 'customer', role: 'customer' },
      { id: 'admin_1', role: 'admin' },
    ];
    expect(adminUserDeleteBlockMessage(targets, 'admin_1', [])).toBe(ADMIN_USER_DELETE_ERRORS.admin);
    expect(adminUserDeleteBlockMessage([{ id: 'customer', role: 'customer' }], 'customer', [])).toBe(ADMIN_USER_DELETE_ERRORS.self);
    expect(adminUserDeleteBlockMessage([{ id: 'owner', role: 'customer' }], 'admin_1', ['owner'])).toBe(ADMIN_USER_DELETE_ERRORS.owner);
    expect(adminUserDeleteBlockMessage([{ id: 'customer', role: 'customer' }], 'admin_1', [])).toBeNull();
  });
});

describe('admin user list selection', () => {
  it('selects only the current search result', () => {
    const visible = filterAdminUsersBySearch(users, '甲');
    expect(visible.map((user) => user.id)).toEqual(['a', 'c']);

    const selected = new Set(visibleSelectedUserIds(visible, new Set(visible.map((user) => user.id))));
    expect([...selected]).toEqual(['a', 'c']);
    expect(visibleSelectedUserIds(visible, new Set(['a', 'b', 'c']))).toEqual(['a', 'c']);
    expect(retainVisibleSelection(['a', 'b', 'c'], visible)).toEqual(['a', 'c']);
  });

  it('keeps the full loaded list when the search is empty', () => {
    expect(filterAdminUsersBySearch(users, '').map((user) => user.id)).toEqual(['a', 'b', 'c']);
    expect(retainVisibleSelection(['b'], users)).toEqual(['b']);
  });
});
