import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserPointsBalance: vi.fn(),
  memberFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  memberCreate: vi.fn(),
  memberDelete: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/points-checkout-service', () => ({ getUserPointsBalance: mocks.getUserPointsBalance }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    researchGroupMember: {
      findUnique: mocks.memberFindUnique,
      findMany: mocks.memberFindMany,
      create: mocks.memberCreate,
      delete: mocks.memberDelete,
    },
    user: { findUnique: mocks.userFindUnique },
  },
}));

import { DELETE, PATCH } from '@/app/api/research-groups/route';
import { GET as getBalance } from '@/app/api/points/balance/route';

const ownerBalance = {
  personalPoints: 80,
  group: {
    id: 'group-1',
    name: '课题组 A',
    points: 120,
    role: 'owner',
    status: 'active',
    locked: true,
    usable: true,
  },
};

describe('课题组成员管理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'owner-1' } });
    mocks.getUserPointsBalance.mockResolvedValue(ownerBalance);
    mocks.memberFindMany.mockResolvedValue([
      {
        id: 'membership-owner',
        role: 'owner',
        user: { id: 'owner-1', email: 'owner@example.com', name: '负责人' },
      },
      {
        id: 'membership-member',
        role: 'member',
        user: { id: 'member-1', email: 'member@example.com', name: '成员甲' },
      },
    ]);
  });

  it('负责人读取积分余额时可以看到成员姓名、邮箱和身份', async () => {
    const response = await getBalance();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      group: {
        id: 'group-1',
        members: [
          { id: 'membership-owner', role: 'owner', user: { name: '负责人', email: 'owner@example.com' } },
          { id: 'membership-member', role: 'member', user: { name: '成员甲', email: 'member@example.com' } },
        ],
      },
    });
    expect(mocks.memberFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupId: 'group-1' },
    }));
  });

  it('普通成员读取积分余额时不会得到成员管理列表', async () => {
    mocks.getUserPointsBalance.mockResolvedValue({
      ...ownerBalance,
      group: { ...ownerBalance.group, role: 'member' },
    });

    const response = await getBalance();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ group: { role: 'member' } });
    expect(body.group.members).toBeUndefined();
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it('负责人可以移除同一课题组的普通成员', async () => {
    mocks.memberFindUnique
      .mockResolvedValueOnce({ groupId: 'group-1', role: 'owner', group: { status: 'active' } })
      .mockResolvedValueOnce({
        id: 'membership-member',
        groupId: 'group-1',
        role: 'member',
        user: { email: 'member@example.com', name: '成员甲' },
      });

    const response = await DELETE(new NextRequest('http://localhost/api/research-groups', {
      method: 'DELETE',
      body: JSON.stringify({ memberId: 'membership-member' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      member: { id: 'membership-member', email: 'member@example.com', name: '成员甲' },
    });
    expect(mocks.memberDelete).toHaveBeenCalledWith({ where: { id: 'membership-member' } });
  });

  it('负责人添加成员后返回成员姓名和邮箱', async () => {
    mocks.memberFindUnique
      .mockResolvedValueOnce({ groupId: 'group-1', role: 'owner', group: { status: 'active', locked: true } })
      .mockResolvedValueOnce(null);
    mocks.userFindUnique.mockResolvedValue({ id: 'member-1', email: 'member@example.com' });
    mocks.memberCreate.mockResolvedValue({
      id: 'membership-member',
      role: 'member',
      user: { id: 'member-1', email: 'member@example.com', name: '成员甲' },
    });

    const response = await PATCH(new NextRequest('http://localhost/api/research-groups', {
      method: 'PATCH',
      body: JSON.stringify({ email: 'member@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      member: { user: { name: '成员甲', email: 'member@example.com' } },
    });
  });

  it('普通成员不能调用移除接口', async () => {
    mocks.memberFindUnique.mockResolvedValue({ groupId: 'group-1', role: 'member', group: { status: 'active' } });

    const response = await DELETE(new NextRequest('http://localhost/api/research-groups', {
      method: 'DELETE',
      body: JSON.stringify({ memberId: 'membership-member' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(403);
    expect(mocks.memberDelete).not.toHaveBeenCalled();
  });

  it('负责人自身不能被移除', async () => {
    mocks.memberFindUnique
      .mockResolvedValueOnce({ groupId: 'group-1', role: 'owner', group: { status: 'active' } })
      .mockResolvedValueOnce({
        id: 'membership-owner',
        groupId: 'group-1',
        role: 'owner',
        user: { email: 'owner@example.com', name: '负责人' },
      });

    const response = await DELETE(new NextRequest('http://localhost/api/research-groups', {
      method: 'DELETE',
      body: JSON.stringify({ memberId: 'membership-owner' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(mocks.memberDelete).not.toHaveBeenCalled();
  });

  it('负责人不能移除其他课题组的成员记录', async () => {
    mocks.memberFindUnique
      .mockResolvedValueOnce({ groupId: 'group-1', role: 'owner', group: { status: 'active' } })
      .mockResolvedValueOnce({
        id: 'membership-other',
        groupId: 'group-2',
        role: 'member',
        user: { email: 'other@example.com', name: '其他成员' },
      });

    const response = await DELETE(new NextRequest('http://localhost/api/research-groups', {
      method: 'DELETE',
      body: JSON.stringify({ memberId: 'membership-other' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(404);
    expect(mocks.memberDelete).not.toHaveBeenCalled();
  });
});
