import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminUsersPage from '@/app/admin/users/page';

const { session } = vi.hoisted(() => ({
  session: {
    data: { user: { role: 'admin', id: 'admin_test_id' } },
    status: 'authenticated' as const,
  },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => session,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
}));

const users = [
  {
    id: 'user_a',
    name: '甲老师',
    email: 'jia@example.com',
    role: 'customer',
    institution: '甲大学',
    tier: '璞玉',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'user_b',
    name: '乙老师',
    email: 'yi@example.com',
    role: 'customer',
    institution: '乙医院',
    tier: '璞玉',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
];

describe('admin users page delete selection', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([false, true])('select-all after search deactivates only visible users (compact=%s)', async (compact) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: compact,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, deactivated: 1 }) });
      }
      if (String(url).includes('/api/admin/discount-templates')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.resolve({ ok: true, json: async () => users });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminUsersPage />);
    expect(await screen.findByRole('checkbox', { name: '选择甲老师' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择乙老师' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('搜索用户名称、邮箱或机构...'), { target: { value: '甲' } });
    expect(screen.queryByRole('checkbox', { name: '选择乙老师' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前结果' }));
    fireEvent.click(screen.getByRole('button', { name: /停用账号/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({ method: 'DELETE' }));
    });
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({ userIds: ['user_a'] });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('订单、积分和授信会保留'));
    expect(await screen.findByText('已停用 1 个用户，订单、积分和授信已保留')).toBeInTheDocument();
  });

  it('mounts one selection control per user and retains selection across breakpoint changes', async () => {
    let change: (() => void) | undefined;
    const media = {
      matches: false,
      addEventListener: vi.fn((_event: string, listener: () => void) => { change = listener; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === '/api/users' ? users : [],
    })));
    const { container, unmount } = render(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择甲老师' }));

    for (const compact of [false, true, false]) {
      act(() => { media.matches = compact; change?.(); });
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
      expect(screen.getAllByRole('checkbox', { name: '全选当前结果' })).toHaveLength(1);
      expect(screen.getByRole('checkbox', { name: '选择甲老师' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: '选择乙老师' })).not.toBeChecked();
      expect(container.querySelectorAll('table')).toHaveLength(compact ? 0 : 1);
      expect(screen.getByRole('checkbox', { name: '选择甲老师' }).closest('tr') !== null).toBe(!compact);
      expect(screen.queryAllByText('最近登录', { exact: true })).toHaveLength(compact ? 2 : 0);
    }
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', change);
  });
});
