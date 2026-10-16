export type AdminUserListSearchFields = {
  id: string;
  name?: string | null;
  email: string;
  institution?: string | null;
  department?: string | null;
  institutionType?: string | null;
  institutionName?: string | null;
  institutionUnit?: string | null;
  institutionFacility?: string | null;
  school?: string | null;
  college?: string | null;
  major?: string | null;
  piLab?: string | null;
  affiliatedLab?: string | null;
};

export function filterAdminUsersBySearch<T extends AdminUserListSearchFields>(users: T[], search: string): T[] {
  if (!search) return users;
  return users.filter((user) => (
    user.name?.includes(search)
    || user.email.includes(search)
    || user.institution?.includes(search)
    || user.department?.includes(search)
    || user.institutionType?.includes(search)
    || user.institutionName?.includes(search)
    || user.institutionUnit?.includes(search)
    || user.institutionFacility?.includes(search)
    || user.school?.includes(search)
    || user.college?.includes(search)
    || user.major?.includes(search)
    || user.piLab?.includes(search)
    || user.affiliatedLab?.includes(search)
  ));
}

export function visibleSelectedUserIds<T extends { id: string }>(
  visibleUsers: T[],
  selectedIds: ReadonlySet<string>,
): string[] {
  return visibleUsers.filter((user) => selectedIds.has(user.id)).map((user) => user.id);
}

/** 搜索变化后丢掉当前结果里看不到的勾选，避免停用未显示的用户。 */
export function retainVisibleSelection(selectedIds: Iterable<string>, visibleUsers: { id: string }[]): string[] {
  const visible = new Set(visibleUsers.map((user) => user.id));
  return [...selectedIds].filter((id) => visible.has(id));
}
