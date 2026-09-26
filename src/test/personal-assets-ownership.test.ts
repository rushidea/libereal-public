import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userSavedBuffer: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  userCreatedRecipe: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { userSavedBuffer: mocks.userSavedBuffer, userCreatedRecipe: mocks.userCreatedRecipe } }));
vi.mock('@/lib/id', () => ({ generateId: (prefix: string) => `${prefix}-1` }));

import * as buffersRoute from '@/app/api/user/buffers/route';
import * as recipesRoute from '@/app/api/user/recipes/route';

describe('personal asset ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.userSavedBuffer.findMany.mockResolvedValue([]);
    mocks.userCreatedRecipe.findMany.mockResolvedValue([]);
    mocks.userSavedBuffer.create.mockResolvedValue({ id: 'buf-1' });
    mocks.userCreatedRecipe.create.mockResolvedValue({ id: 'rec-1' });
  });

  it('keeps saved buffers personal after organization membership changes', async () => {
    await buffersRoute.GET(new NextRequest('http://localhost/api/user/buffers'));
    expect(mocks.userSavedBuffer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', ownerScope: 'personal' } }));

    await buffersRoute.POST(new NextRequest('http://localhost/api/user/buffers', {
      method: 'POST',
      body: JSON.stringify({ name: '缓冲液', calculatorType: 'buffer', parameters: {}, result: {} }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(mocks.userSavedBuffer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', ownerScope: 'personal' }) }));
  });

  it('keeps created recipes personal after organization membership changes', async () => {
    await recipesRoute.GET(new NextRequest('http://localhost/api/user/recipes'));
    expect(mocks.userCreatedRecipe.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', ownerScope: 'personal' } }));

    await recipesRoute.POST(new NextRequest('http://localhost/api/user/recipes', {
      method: 'POST',
      body: JSON.stringify({ type: 'protocol', name: '方案', content: {} }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(mocks.userCreatedRecipe.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', ownerScope: 'personal' }) }));
  });
});
