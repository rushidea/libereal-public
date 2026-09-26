import { describe, expect, it } from 'vitest';
import { parseAdminUsersResponse } from '@/data/admin-users-response';

describe('parseAdminUsersResponse', () => {
  it('accepts the current array response', () => {
    expect(parseAdminUsersResponse<{ id: string }>([{ id: 'u1' }])).toEqual([{ id: 'u1' }]);
  });

  it('accepts a paginated users response', () => {
    expect(parseAdminUsersResponse<{ id: string }>({ users: [{ id: 'u2' }], total: 1 })).toEqual([{ id: 'u2' }]);
  });

  it('rejects error and malformed responses', () => {
    expect(parseAdminUsersResponse({ error: 'Internal server error' })).toBeNull();
    expect(parseAdminUsersResponse(null)).toBeNull();
  });
});
