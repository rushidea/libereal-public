import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' })),
}));
vi.mock('@/lib/session', () => ({ requireAdmin }));

import { GET, PATCH } from '@/app/api/admin/tasks/route';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { prisma } from '@/lib/prisma';

describe('admin task routes', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    requireAdmin.mockClear();
  });

  it('lists tasks with status summaries', async () => {
    await enqueueBackgroundTask('email.send', { to: 'user@example.com' });
    const response = await GET(new NextRequest('http://localhost:3000/api/admin/tasks?status=pending'));
    expect(response.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledWith('tasks.read');
    const data = await response.json();
    expect(data.total).toBe(1);
    expect(data.counts.pending).toBe(1);
  });

  it('retries a failed task and writes an audit entry', async () => {
    const task = await enqueueBackgroundTask('sms.send', {});
    await prisma.backgroundTask.update({ where: { id: task.id }, data: { status: 'failed', attempts: 3, lastError: 'send failed' } });
    const response = await PATCH(new NextRequest('http://localhost:3000/api/admin/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, action: 'retry' }),
    }));
    expect(response.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledWith('tasks.manage');
    expect(getTestDb().prepare('SELECT action, resource FROM AuditLog WHERE targetId = ?').get(task.id)).toEqual({ action: 'task.retried', resource: 'tasks' });
  });
});
