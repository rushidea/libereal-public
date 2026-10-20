import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import UserRow from '@/components/admin/UserRow';

const user = {
  id: 'user-permissions',
  name: 'Permission User',
  email: 'permission@example.com',
  role: 'customer',
  tier: '璞玉',
  createdAt: '2026-01-02T00:00:00.000Z',
  creditAccount: {
    baseLimit: 1000,
    overrideLimit: null,
    temporaryLimit: 0,
    temporaryUntil: null,
    usedAmount: 0,
    status: 'paused',
    paymentTermDays: 30,
  },
};

function renderRow(layout: 'table' | 'compact', permissions: { canWriteCustomers?: boolean; canWriteTier?: boolean; canWriteCredit?: boolean } = {}) {
  const row = (
    <UserRow
      layout={layout}
      user={user}
      onUpdate={() => {}}
      showEditButton
      {...permissions}
    />
  );
  return layout === 'table' ? render(<table><tbody>{row}</tbody></table>) : render(row);
}

function openEditor() {
  fireEvent.click(screen.getByTitle('编辑'));
}

function getTierSelect() {
  return screen.getAllByRole('combobox').find((element) =>
    Array.from((element as HTMLSelectElement).options).some((option) => option.value === '翡翠'),
  ) as HTMLSelectElement;
}

function getCreditStatusSelect() {
  return screen.getAllByRole('combobox').find((element) =>
    Array.from((element as HTMLSelectElement).options).some((option) => option.value === 'paused'),
  ) as HTMLSelectElement;
}

describe('UserRow permission-scoped editor controls', () => {
  afterEach(() => cleanup());

  it.each(['table', 'compact'] as const)('blocks profile saves and credit/tier controls without permissions in %s layout', async (layout) => {
    renderRow(layout);
    openEditor();

    const name = screen.getByDisplayValue('Permission User');
    fireEvent.change(name, { target: { value: 'Changed Name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.getByText('修改客户资料需要客户管理权限。')).toBeTruthy());
    expect(getTierSelect()).toBeDisabled();
    expect(getCreditStatusSelect()).toBeDisabled();
    expect(screen.getAllByTitle('修改授信需要财务权限').every((element) => (element as HTMLInputElement).disabled)).toBe(true);
  });

  it.each(['table', 'compact'] as const)('keeps pricing and finance permissions independent in %s layout', (layout) => {
    renderRow(layout, { canWriteTier: true });
    openEditor();

    expect(getTierSelect()).not.toBeDisabled();
    expect(getCreditStatusSelect()).toBeDisabled();

    cleanup();
    renderRow(layout, { canWriteCredit: true });
    openEditor();

    expect(getTierSelect()).toBeDisabled();
    expect(getCreditStatusSelect()).not.toBeDisabled();
    expect(getCreditStatusSelect()).toHaveValue('paused');
  });
});
