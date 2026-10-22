import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminOrdersPage from '@/app/admin/orders/page';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin', email: 'admin@example.test' } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const longName = '中国科学院分子细胞科学卓越创新中心张研究员课题组';
const longEmail = 'principal.investigator.laboratory@sibcb.ac.cn';
const longInstitution = '中国科学院上海生命科学研究院生物化学与细胞生物学研究所';
const longDepartment = '分子细胞科学卓越创新中心肿瘤微环境与免疫实验室';

const orders = [
  {
    id: 'ORD-20261015-001',
    name: longName,
    email: longEmail,
    phone: '13800000000',
    institution: longInstitution,
    department: '订单部门',
    userDepartment: longDepartment,
    items: [],
    subtotal: 1280.5,
    total: 1280.5,
    status: 'pending',
    createdAt: '2026-10-15T02:00:00.000Z',
  },
  {
    id: 'ORD-20261015-002',
    name: '李明',
    email: 'liming@example.test',
    phone: '',
    institution: '',
    items: [],
    subtotal: 20,
    total: 20,
    status: 'confirmed',
    createdAt: '2026-10-14T02:00:00.000Z',
  },
];

describe('admin orders desktop table', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('gives customer and institution columns the remaining width and shows the full text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        orders,
        page: 1,
        pageSize: 20,
        total: orders.length,
        statusCounts: { pending: 1, confirmed: 1 },
        receivableSummary: null,
      }),
    })));

    render(<AdminOrdersPage />);

    const table = await screen.findByRole('table');
    expect(table).toHaveClass('w-full', 'min-w-[52rem]', 'table-fixed');
    expect(table.className).not.toContain('min-w-[1000px]');
    expect(table.parentElement).toHaveClass('overflow-x-auto');

    const columns = table.querySelectorAll('col');
    expect(columns).toHaveLength(8);
    expect(columns[1]).toHaveClass('w-[9rem]');
    expect(columns[2]).toHaveClass('w-auto');
    expect(columns[3]).toHaveClass('w-auto');
    expect(columns[4]).toHaveClass('w-[8.5rem]');
    expect(columns[5]).toHaveClass('w-[8rem]');
    expect(columns[6]).toHaveClass('w-[6rem]');
    expect(columns[7]).toHaveClass('w-[4rem]');
    expect(table.innerHTML).not.toContain('w-[22%]');
    expect(table.innerHTML).not.toContain('w-[20%]');

    const customer = within(table).getByText(longName);
    const email = within(table).getByText(longEmail);
    const institution = within(table).getByText(longInstitution);
    const department = within(table).getByText(longDepartment);
    expect(customer).toHaveAttribute('title', longName);
    expect(email).toHaveAttribute('title', longEmail);
    expect(institution).toHaveAttribute('title', longInstitution);
    expect(department).toHaveAttribute('title', longDepartment);
    for (const node of [customer, email, institution, department]) {
      expect(node.className).not.toContain('truncate');
    }
    expect(customer).toHaveClass('break-words');
    expect(email).toHaveClass('break-all');
    expect(institution).toHaveClass('break-words');
    expect(department).toHaveClass('break-words');

    const shortRow = within(table).getByText('李明').closest('tr');
    expect(shortRow).not.toBeNull();
    const shortCells = within(shortRow as HTMLElement).getAllByRole('cell');
    expect(shortCells[2]).toHaveTextContent('李明');
    expect(shortCells[2]).toHaveTextContent('liming@example.test');
    expect(shortCells[3]).toHaveTextContent('-');
    expect(shortCells[3].querySelector('[title]')).toBeNull();
    expect(within(table).getByText('ORD-20261015-001')).not.toHaveClass('truncate');
    expect(within(table).getByText('¥1,280.50')).toHaveClass('whitespace-nowrap');
    expect(within(table).getByText('待确认')).toBeInTheDocument();
  });
});
