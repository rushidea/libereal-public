import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
}));

import { POST as quotePOST } from '@/app/api/inquiries/[id]/quote/route';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { notifyAdminInquiryTodoChanged } from '@/lib/admin-inquiry-todo';
import { countAdminInquiryTodos } from '@/lib/admin-inquiry-todo-count';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedAdmin, clearAllTables } from './db-helpers';

function seedInquiry(id: string) {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, archivedAt, createdAt, operationLogs, has_unresolved_pricing)
    VALUES (?, '询价人', 'q@test.com', '13800000000', '清华大学', 'pending_quote', NULL, datetime('now'), '[]', 0)
  `).run(id);
  db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, createdAt, updatedAt)
    VALUES (?, ?, 0, 'p1', 'A', 100, 1, 100, datetime('now'), datetime('now'))
  `).run(`${id}_item_0`, id);
}

describe('admin 询价管理 badge', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedInquiry('inq_pending');
  });

  it('inquiry pending -> badge 1; quote submitted -> badge 0', async () => {
    expect(await countAdminInquiryTodos()).toBe(1);

    const response = await quotePOST(
      new NextRequest('http://localhost:3000/api/inquiries/inq_pending/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ productId: 'p1', name: 'A', price: 100, quantity: 1 }] }),
      }),
      { params: Promise.resolve({ id: 'inq_pending' }) },
    );

    expect(response.status).toBe(200);
    expect(await countAdminInquiryTodos()).toBe(0);
  });

  it('does not count an inquiry after staff already recorded a quote', async () => {
    getTestDb().prepare('UPDATE Inquiry SET operationLogs = ? WHERE id = ?').run(
      JSON.stringify([{ adminEmail: 'yuanyuan@example.com', time: '2026-10-01T00:00:00.000Z', items: [{ name: 'A', price: 100, quantity: 1 }] }]),
      'inq_pending',
    );

    expect(await countAdminInquiryTodos()).toBe(0);
  });
});

describe('admin sidebar inquiry badge refresh', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('clears the 询价管理 badge as soon as the quote refresh event arrives', async () => {
    let inquiries = 1;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/admin/access')) {
        return Response.json({ permissions: ['admin.access', 'inquiries.read', 'orders.read', 'customers.read'] });
      }
      if (url.includes('/api/admin/analytics')) {
        return Response.json({ todo: { orders: 0, inquiries, users: 0, community: 0, organizations: 0 } });
      }
      return new Response(null, { status: 404 });
    }));

    render(<AdminSidebar />);
    expect(await screen.findAllByTestId('admin-nav-badge-inquiries')).toEqual(
      expect.arrayContaining([expect.objectContaining({})]),
    );
    for (const badge of screen.getAllByTestId('admin-nav-badge-inquiries')) {
      expect(badge).toHaveTextContent('1');
    }

    inquiries = 0;
    notifyAdminInquiryTodoChanged();
    await waitFor(() => {
      expect(screen.queryAllByTestId('admin-nav-badge-inquiries')).toHaveLength(0);
    });
  });
});
