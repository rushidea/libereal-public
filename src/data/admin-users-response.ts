export function parseAdminUsersResponse<T>(payload: unknown): T[] | null {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { users?: unknown }).users)) {
    return (payload as { users: T[] }).users;
  }
  return null;
}
