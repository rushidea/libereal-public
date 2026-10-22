import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import UserRow from '@/components/admin/UserRow';

const longName = 'SupercalifragilisticexpialidociousUnbrokenDisplayNameForOverflowCheck';
const longEmail = 'very.long.unbroken.local.part.that.should.not.fit.inside.a.narrow.card@institution-of-extremely-long-domain-name.example.com';
const longRole = 'customer-with-an-extremely-long-custom-role-identifier';
const longOrg = 'VeryLongInstitutionNameWithoutSpacesThatShouldOverflowTheCardBoundaryExampleUniversity';
const longPhone = '+86-13800138000-ext-123456789012345678901234567890';

const user = {
  id: `usr_${'idsegment'.repeat(8)}`,
  name: longName,
  email: longEmail,
  role: longRole,
  phone: longPhone,
  institutionName: longOrg,
  tier: 'standard',
  createdAt: '2026-01-02T00:00:00.000Z',
  lastLoginAt: '2026-03-01T08:30:00.000Z',
  sourceTemplateId: 'tpl-long',
};

function renderRow(layout: 'table' | 'compact') {
  const row = (
    <UserRow
      layout={layout}
      user={user}
      onUpdate={() => {}}
      showEditButton
      templates={[{ id: 'tpl-long', name: '战略合作客户超长折扣模板名称' }]}
    />
  );
  if (layout === 'table') {
    return render(<table><tbody>{row}</tbody></table>);
  }
  return render(row);
}

describe('UserRow list layout', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(['table', 'compact'] as const)('truncates long %s values and keeps the full text in the title', (layout) => {
    renderRow(layout);

    for (const value of [longName, longEmail, longPhone, longOrg, longRole]) {
      const node = screen.getAllByTitle(value)[0];
      expect(node.className).toContain('truncate');
      expect(node.className).toContain('max-w-full');
    }

    expect(screen.getByTitle('编辑')).toBeTruthy();
    expect(screen.getByTitle('冻结')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getAllByTitle((title) => String(title).includes('2026/1/2'))[0].className).toContain('truncate');
    expect(screen.getAllByTitle((title) => String(title).includes('2026/3/1'))[0].className).toContain('truncate');
  });
});
