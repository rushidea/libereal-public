import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationsPanel from '@/components/account/OrganizationsPanel';

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => sessionMock(),
}));

type JsonResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function jsonResponse(data: unknown, status = 200): JsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

const ownerOrganization = {
  id: 'org-1',
  name: '测试组织',
  status: 'active',
  ownerUserId: 'admin-user',
  membershipId: 'member-1',
  roles: [{ key: 'owner', name: '组织所有者' }],
};

const memberOrganization = {
  ...ownerOrganization,
  ownerUserId: 'owner-other',
  roles: [],
};

const adminOrganization = {
  ...memberOrganization,
  roles: [{ key: 'admin', name: '审计员' }],
};

const members = [
  {
    id: 'member-1',
    userId: 'admin-user',
    email: 'admin@test.com',
    name: '管理员',
    status: 'active',
    joinedAt: '2026-08-08T00:00:00Z',
    createdAt: '2026-08-08T00:00:00Z',
    pendingRole: null,
    roles: [{ key: 'owner', name: '组织所有者' }],
  },
  {
    id: 'member-2',
    userId: 'researcher-user',
    email: 'researcher@test.com',
    name: '研究员',
    status: 'active',
    joinedAt: '2026-08-08T00:00:00Z',
    createdAt: '2026-08-08T00:00:00Z',
    pendingRole: null,
    roles: [{ key: 'researcher', name: '研究员' }],
  },
];

function pendingApproval(id: string, requesterId: string, kind = 'role_change') {
  return {
    id,
    kind,
    status: 'pending',
    requestedRole: 'admin',
    createdAt: '2026-08-08T01:00:00Z',
    reviewedAt: null,
    requester: { id: requesterId, email: `${requesterId}@test.com`, name: '提交人' },
    member: { id: 'member-2', userId: 'researcher-user', email: 'researcher@test.com', name: '研究员' },
  };
}

function defaultFetchMock() {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/organizations') {
      return jsonResponse({ organizations: [ownerOrganization], canCreateOrganization: true });
    }
    if (path.endsWith('/members') && (!init?.method || init.method === 'GET')) {
      return jsonResponse({ members });
    }
    if (path.endsWith('/approvals')) {
      return jsonResponse({ approvals: [] });
    }
    return jsonResponse({});
  });
}

describe('OrganizationsPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionMock.mockReturnValue({
      data: { user: { id: 'admin-user', email: 'admin@test.com' } },
      status: 'authenticated',
    });
    fetchMock = defaultFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('未登录时显示登录引导且不请求组织接口', () => {
    sessionMock.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<OrganizationsPanel />);

    expect(screen.getByText('登录后可管理组织。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往登录' })).toHaveAttribute('href', '/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('操作成功提示在刷新后仍然显示', async () => {
    render(<OrganizationsPanel />);

    const inviteInput = await screen.findByLabelText('成员邮箱');
    fireEvent.change(inviteInput, { target: { value: 'new@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: /邀请成员/ }));

    await screen.findByText('邀请已发送，等待成员本人确认加入。');
    expect(screen.getByRole('status')).toHaveTextContent('邀请已发送，等待成员本人确认加入。');
  });

  it('将创建组织入口放在我的组织页眉，创建成功后隐藏入口', async () => {
    let created = false;
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/organizations' && init?.method === 'POST') {
        created = true;
        return jsonResponse({ organization: { ...ownerOrganization, status: 'pending' } }, 201);
      }
      if (path === '/api/organizations') {
        return jsonResponse({ organizations: created ? [{ ...ownerOrganization, status: 'pending' }] : [], canCreateOrganization: true });
      }
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    expect(await screen.findByRole('button', { name: '创建组织' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建组织' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '创建组织' }));
    const dialog = await screen.findByRole('dialog', { name: '创建组织' });
    fireEvent.change(within(dialog).getByLabelText('组织名称'), { target: { value: '新测试组织' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建组织' }));

    await screen.findByText('组织申请已提交，等待平台管理员审核。');
    expect(screen.queryByRole('button', { name: '创建组织' })).not.toBeInTheDocument();
  });

  it('平台关闭组织创建时显示状态且隐藏创建入口', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === '/api/organizations') return jsonResponse({ organizations: [], canCreateOrganization: false });
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    expect(await screen.findByText('当前账户未获得创建权限')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建组织' })).not.toBeInTheDocument();
  });

  it('创建组织提交平台审核且不要求 MFA', async () => {
    let createAttempts = 0;
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/organizations' && init?.method === 'POST') {
        createAttempts += 1;
        return jsonResponse({ organization: { ...ownerOrganization, status: 'pending' } }, 201);
      }
      if (path === '/api/organizations') {
        return jsonResponse({ organizations: createAttempts > 0 ? [{ ...ownerOrganization, status: 'pending' }] : [], canCreateOrganization: true });
      }
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '创建组织' }));
    const createDialog = await screen.findByRole('dialog', { name: '创建组织' });
    fireEvent.change(within(createDialog).getByLabelText('组织名称'), { target: { value: '需要验证的组织' } });
    fireEvent.click(within(createDialog).getByRole('button', { name: '创建组织' }));

    await screen.findByText('组织申请已提交，等待平台管理员审核。');
    expect(createAttempts).toBe(1);
    expect(screen.queryByRole('button', { name: '创建组织' })).not.toBeInTheDocument();
  });

  it('审核未通过的组织由所有者看到删除入口并使用页面内确认窗口', async () => {
    let deleted = false;
    const rejectedOrganization = { ...ownerOrganization, status: 'rejected' };
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith('/org-1') && init?.method === 'DELETE') {
        deleted = true;
        return jsonResponse({ organization: { organizationId: 'org-1', status: 'deleted' } });
      }
      if (path === '/api/organizations') return jsonResponse({ organizations: deleted ? [] : [rejectedOrganization], canCreateOrganization: true });
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '删除组织' }));
    expect(await screen.findByRole('dialog', { name: '删除组织' })).toHaveTextContent('组织成员、角色和申请记录将一并移除');
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await screen.findByText('组织已删除。');
    expect(deleted).toBe(true);
    expect(screen.queryByRole('button', { name: '删除组织' })).not.toBeInTheDocument();
  });

  it('展示待确认成员的申请角色与邀请 ID，并将组织资料编辑入口放在我的组织区', async () => {
    const pendingMember = {
      id: 'member-pending',
      userId: 'pending-user',
      email: 'pending@test.com',
      name: null,
      status: 'pending',
      joinedAt: null,
      createdAt: '2026-08-08T02:00:00Z',
      pendingRole: 'researcher',
      roles: [],
    };
    fetchMock.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path === '/api/organizations') return jsonResponse({ organizations: [ownerOrganization], canCreateOrganization: true });
      if (path.endsWith('/members')) return jsonResponse({ members: [members[0], pendingMember] });
      if (path.endsWith('/approvals')) return jsonResponse({ approvals: [] });
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    expect(await screen.findByText('邀请 ID：member-pending')).toBeInTheDocument();
    expect(screen.getByText(/待成员确认/)).toBeInTheDocument();
    expect(screen.getAllByText('研究员').length).toBeGreaterThan(0);
    expect(screen.getByText('所有者和具备成员管理权限的成员可调整下级成员权限。')).toBeInTheDocument();
    expect(screen.getByText('身份：组织所有者')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑资料' }));
    expect(screen.getByLabelText('组织名称')).toBeInTheDocument();
    const editButton = screen.getByRole('button', { name: '编辑资料' });
    const organizationHeading = screen.getByRole('heading', { name: '我的组织' });
    const membersHeading = screen.getByRole('heading', { name: /· 成员$/ });
    expect(organizationHeading.compareDocumentPosition(editButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editButton.compareDocumentPosition(membersHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('退出组织使用页面内确认窗口并说明组织与个人数据影响', async () => {
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/organizations') return jsonResponse({ organizations: [memberOrganization], canCreateOrganization: true });
      if (path.endsWith('/members')) return jsonResponse({ members: [] });
      if (path.endsWith('/leave') && init?.method === 'POST') return jsonResponse({ membership: { status: 'removed' } });
      return jsonResponse({ approvals: [] });
    });

    render(<OrganizationsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '退出组织' }));
    expect(await screen.findByRole('dialog', { name: '退出组织' })).toHaveTextContent('组织采购、应付款、询价及其他组织记录仍归该组织所有');
    expect(screen.getByRole('dialog')).toHaveTextContent('个人账户资料、个人配方和个人记录保持不变');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '退出组织' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, requestInit]) => String(url).endsWith('/leave') && requestInit?.method === 'POST')).toBe(false);
  });

  it('本人提交的审批请求不显示操作按钮，他人请求显示通过和拒绝', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path === '/api/organizations') {
        return jsonResponse({ organizations: [ownerOrganization], canCreateOrganization: true });
      }
      if (path.endsWith('/members')) {
        return jsonResponse({ members });
      }
      if (path.endsWith('/approvals')) {
        return jsonResponse({
          approvals: [
            pendingApproval('approval-own', 'admin-user'),
            pendingApproval('approval-other', 'other-admin'),
          ],
        });
      }
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    await screen.findByText('待处理审批');
    expect(await screen.findByText('等待组织所有者审批')).toBeInTheDocument();
    expect(screen.getAllByText('等待组织所有者审批')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '通过' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '拒绝' })).toHaveLength(1);
  });

  it('接口返回 MFA 校验要求时弹出二次验证窗口，验证通过后自动重试原操作', async () => {
    let inviteAttempts = 0;
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/organizations') {
        return jsonResponse({ organizations: [ownerOrganization], canCreateOrganization: true });
      }
      if (path.endsWith('/members') && init?.method === 'GET') {
        return jsonResponse({ members });
      }
      if (path.endsWith('/approvals')) {
        return jsonResponse({ approvals: [] });
      }
      if (path.endsWith('/members') && init?.method === 'POST') {
        inviteAttempts += 1;
        return jsonResponse({ invitation: { id: 'invite-1' } }, 201);
      }
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    const inviteInput = await screen.findByLabelText('成员邮箱');
    fireEvent.change(inviteInput, { target: { value: 'new@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: /邀请成员/ }));

    await screen.findByText('邀请已发送，等待成员本人确认加入。');
    expect(inviteAttempts).toBe(1);
  });

  it('一般成员不显示成员管理模块且仍可提交退出申请', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path === '/api/organizations') {
        return jsonResponse({ organizations: [memberOrganization], canCreateOrganization: true });
      }
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    expect(await screen.findByRole('button', { name: '退出组织' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出组织' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /· 成员$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('待处理审批')).not.toBeInTheDocument();
    const requestedPaths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedPaths).toEqual(['/api/organizations']);
  });

  it('审计员可以看到组织历史入口但不能编辑组织资料', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path === '/api/organizations') return jsonResponse({ organizations: [adminOrganization], canCreateOrganization: true });
      if (path.endsWith('/members')) return jsonResponse({ members: [] });
      if (path.endsWith('/approvals')) return jsonResponse({ approvals: [] });
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    expect(await screen.findByRole('link', { name: '组织历史' })).toHaveAttribute('href', '/account/organizations/history?organizationId=org-1');
    expect(screen.queryByRole('button', { name: '编辑资料' })).not.toBeInTheDocument();
  });

  it('切换成员角色时同步角色默认权限', async () => {
    let roleChanged = false;
    const purchasingMember = {
      ...members[1],
      roles: [{ key: 'purchasing', name: '采购' }],
      permissions: ['organization.read', 'organization.members.read', 'organization.orders.create', 'organization.pricing.read'],
    };
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/organizations') return jsonResponse({ organizations: [ownerOrganization], canCreateOrganization: true });
      if (path.endsWith('/members/member-2') && init?.method === 'PATCH') {
        roleChanged = true;
        return jsonResponse({ request: { memberId: 'member-2', roleKey: 'purchasing', applied: true } });
      }
      if (path.endsWith('/members')) return jsonResponse({ members: roleChanged ? [members[0], purchasingMember] : members });
      if (path.endsWith('/approvals')) return jsonResponse({ approvals: [] });
      return jsonResponse({});
    });

    render(<OrganizationsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '权限设置' }));
    expect(screen.getByLabelText('创建订单')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('researcher@test.com 的新角色'), { target: { value: 'purchasing' } });
    expect(screen.getByLabelText('创建订单')).toBeChecked();
    expect(screen.getByLabelText('提交询价')).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '修改角色' }));

    await screen.findByText('角色已更新，默认权限已同步。');
    expect(roleChanged).toBe(true);
    expect(screen.getByLabelText('创建订单')).toBeChecked();
    expect(screen.getByLabelText('提交询价')).not.toBeChecked();
  });
});
