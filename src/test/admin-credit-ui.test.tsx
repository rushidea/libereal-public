import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDaysToShanghaiDate,
  formatCreditDateForInput,
  formatQuoteConfirmError,
  previewEffectiveCreditLimit,
  validateCreditDraftInput,
  type CustomerCreditSummary,
} from '@/lib/credit-summary';
import { adminPermissionErrorMessage } from '@/data/admin-permission-message';
import type { MerchantOrderApprovalPreview } from '@/lib/order-approval';
import CustomerCreditEditor from '@/components/admin/CustomerCreditEditor';
import UserRow from '@/components/admin/UserRow';
import AdminUsersPage from '@/app/admin/users/page';
import AdminOrdersPage from '@/app/admin/orders/page';
import AccountOrdersPage from '@/app/account/orders/page';

const navigationState = vi.hoisted(() => ({ search: '' }));
const stableAdminSession = vi.hoisted(() => ({
  data: { user: { role: 'admin', id: 'admin_1', email: 'admin@test.com' } },
  status: 'authenticated' as const,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => stableAdminSession,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/AdaptiveHeader', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@/components/mobile/MobileBottomNav', () => ({ default: () => null }));
vi.mock('@/context/CustomerNotificationsContext', () => ({
  useMarkNotificationModuleRead: () => {},
}));

const baseSummary: CustomerCreditSummary = {
  tierDefaultLimit: 5000,
  baseLimit: 5000,
  overrideLimit: null,
  permanentLimit: 5000,
  temporaryLimit: 0,
  temporaryUntil: null,
  activeTemporaryLimit: 0,
  effectiveLimit: 5000,
  usedAmount: 0,
  availableAmount: 5000,
  status: 'active',
  paymentTermDays: 30,
  hasAccount: false,
};

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('credit summary helpers and admin credit UI', () => {
  afterEach(() => {
    cleanup();
    navigationState.search = '';
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('formats quote confirm errors, Shanghai expiry dates, and draft validation cleanly', () => {
    expect(
      formatQuoteConfirmError(
        {
          code: 'CREDIT_ACCOUNT_SUSPENDED',
          error: '您的授信账户当前已暂停或处于逾期限制状态，暂不可使用账期确认订单。',
        },
        403,
      ),
    ).toBe('您的授信账户当前已暂停或处于逾期限制状态，暂不可使用账期确认订单。');

    expect(
      formatQuoteConfirmError(
        {
          code: 'CREDIT_LIMIT_EXCEEDED',
          error: '当前可用授信额度不足',
        },
        409,
      ),
    ).toBe('当前可用授信额度不足');

    expect(
      formatQuoteConfirmError(
        {
          code: 'CREDIT_VERSION',
          error: '报价已变化',
        },
        409,
      ),
    ).toBe('报价已变化');

    expect(
      formatQuoteConfirmError(
        {
          code: 'QUOTE_VERSION_CONFLICT',
          error: '报价版本已变化，请刷新后重新核对。',
        },
        409,
      ),
    ).toBe('报价版本已变化，请刷新后重新核对。');

    expect(
      formatQuoteConfirmError(
        {
          code: 'QUOTE_STALE',
          error: '报价已过期',
        },
        409,
      ),
    ).toBe('报价已过期 请刷新后重新核对。');

    // Timezone edge cases in Asia/Shanghai (+08:00)
    expect(formatCreditDateForInput('2026-11-30T23:59:59.999+08:00')).toBe('2026-11-30');
    expect(formatCreditDateForInput('2026-11-30T15:59:59.999Z')).toBe('2026-11-30');
    expect(formatCreditDateForInput('2026-11-30T16:00:00.000Z')).toBe('2026-12-01');
    expect(addDaysToShanghaiDate(7, new Date('2026-11-25T16:30:00.000Z'))).toBe('2026-12-03');

    expect(
      validateCreditDraftInput({
        creditOverride: '',
        temporaryLimit: '9000',
        temporaryUntil: '',
        paymentTermDays: '30',
        creditStatus: 'active',
      }),
    ).toEqual({
      ok: false,
      error: '填写临时额度后，必须选择到期日（到期日当天 23:59 前有效）。',
    });

    expect(
      validateCreditDraftInput({
        creditOverride: '15000',
        temporaryLimit: '0',
        temporaryUntil: '2026-12-30',
        paymentTermDays: '45',
        creditStatus: 'active',
      }),
    ).toEqual({
      ok: true,
      payload: {
        overrideLimit: 15000,
        temporaryLimit: 0,
        temporaryUntil: null,
        status: 'active',
        paymentTermDays: 45,
      },
    });

    // Expired temporary dates must not inflate previewEffectiveCreditLimit
    expect(
      previewEffectiveCreditLimit(
        5000,
        {
          creditOverride: '',
          temporaryLimit: '8000',
          temporaryUntil: '2026-11-30',
          creditStatus: 'active',
        },
        new Date('2026-11-30T15:59:00.000Z'),
      ),
    ).toBe(13000);
    expect(
      previewEffectiveCreditLimit(
        5000,
        {
          creditOverride: '',
          temporaryLimit: '8000',
          temporaryUntil: '2026-11-30',
          creditStatus: 'active',
        },
        new Date('2026-11-30T16:00:00.000Z'),
      ),
    ).toBe(5000);

    expect(adminPermissionErrorMessage('Admin MFA required')).toContain('身份确认');
  });

  it('validates temp-limit expiry and retries save after MFA step-up dialog in CustomerCreditEditor', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/admin/users/usr_1/credit' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as { stepUpToken?: string; overrideLimit?: number };
        if (!body.stepUpToken) {
          return makeJsonResponse({ error: 'Admin MFA required', code: 'ADMIN_MFA_STEP_UP_REQUIRED' }, 403);
        }
        return makeJsonResponse({ ok: true, summary: { ...baseSummary, overrideLimit: body.overrideLimit ?? 15000 } }, 200);
      }
      if (url.startsWith('/api/auth/security/step-up')) {
        if (!init?.method) {
          return makeJsonResponse({ methods: ['email'], preferredMethod: 'email' });
        }
        const body = JSON.parse(String(init.body || '{}')) as { challengeId?: string };
        if (!body.challengeId) {
          return makeJsonResponse({ challengeId: 'email-ch-1' });
        }
        return makeJsonResponse({ grantToken: 'stepup_grant_123' });
      }
      return makeJsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn(async () => {});
    render(
      <CustomerCreditEditor
        userId="usr_1"
        userName="测试客户"
        tier="璞玉"
        summary={baseSummary}
        canWriteCredit
        suggestedMinTotal={13230}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByText(/当前客户等级：璞玉（等级默认 ¥5,000）/)).toBeInTheDocument();

    // Filling temporary limit without expiry must be blocked client-side before fetch
    fireEvent.change(screen.getByLabelText('临时额度（叠加生效）'), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: '保存授信' }));
    expect(screen.getByRole('status')).toHaveTextContent('必须选择到期日');
    expect(fetchMock).not.toHaveBeenCalled();

    // Quick-fill temporary limit populates shortfall (+¥8,230) and +30 days expiry
    fireEvent.click(screen.getByRole('button', { name: /填入本单所需临时额度/ }));
    expect((screen.getByLabelText('临时额度（叠加生效）') as HTMLInputElement).value).toBe('8230');
    expect((screen.getByLabelText('临时额度到期日') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Clear temp limit, set permanent override and trigger MFA step-up
    fireEvent.change(screen.getByLabelText('临时额度（叠加生效）'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('永久额度（覆盖等级默认）'), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: '保存授信' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: '发送邮箱验证码' }));
    const stepUpInput = await within(dialog).findByLabelText('邮箱验证码');
    fireEvent.change(stepUpInput, { target: { value: '825174' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证并继续' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('授信额度已保存');

    const creditPatches = fetchMock.mock.calls.filter(
      ([u, opts]) => String(u) === '/api/admin/users/usr_1/credit' && opts?.method === 'PATCH',
    );
    expect(creditPatches).toHaveLength(2);
    const secondPayload = JSON.parse(String(creditPatches[1]?.[1]?.body || '{}')) as {
      stepUpToken?: string;
      overrideLimit?: number | null;
      temporaryUntil?: string | null;
    };
    expect(secondPayload.stepUpToken).toBe('stepup_grant_123');
    expect(secondPayload.overrideLimit).toBe(15000);
    expect(secondPayload.temporaryUntil).toBeNull();
  });

  it('renders UserRow real tier default credit, switches between credit/full editors, and syncs updates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeJsonResponse({})));

    const user = {
      id: 'usr_row_1',
      email: '61216888@qq.com',
      name: '张工',
      phone: '13800138000',
      company: '光谷科研',
      role: 'customer',
      tier: '璞玉',
      isFrozen: false,
      frozenReason: null,
      notes: null,
      discountOverride: null,
      points: 0,
      balance: 0,
      createdAt: '2026-11-01T00:00:00.000Z',
      lastLoginAt: null,
      creditSummary: baseSummary,
    };

    const { rerender } = render(
      <table>
        <tbody>
          <UserRow
            user={user}
            onUpdate={vi.fn()}
            showEditButton
            canWriteCustomers
            canWriteTier
            canWriteCredit
          />
        </tbody>
      </table>,
    );

    expect(screen.getByText('¥5,000')).toBeInTheDocument();
    expect(screen.queryByText('¥0')).not.toBeInTheDocument();

    // Open credit editor from explicit 授信 button
    fireEvent.click(screen.getByTitle('调整授信额度'));
    expect(screen.getByText(/授信额度与账期调整/)).toBeInTheDocument();

    // Switch to full editor and confirm colSpan=7 row layout
    fireEvent.click(screen.getByRole('button', { name: '编辑完整用户资料' }));
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' }).closest('td')).toHaveAttribute('colspan', '7');

    // Reopen credit mode and check compact card mode + summary sync (+临 badge)
    fireEvent.click(screen.getByTitle('调整授信额度'));
    const updatedUser = {
      ...user,
      creditSummary: {
        ...baseSummary,
        overrideLimit: 18000,
        permanentLimit: 18000,
        temporaryLimit: 2000,
        temporaryUntil: '2026-12-30T15:59:59.999Z',
        activeTemporaryLimit: 2000,
        effectiveLimit: 20000,
        availableAmount: 20000,
        hasAccount: true,
      },
    };

    rerender(
      <table>
        <tbody>
          <UserRow
            user={updatedUser}
            onUpdate={vi.fn()}
            showEditButton
            canWriteCustomers
            canWriteTier
            canWriteCredit
          />
        </tbody>
      </table>,
    );

    await waitFor(() => {
      expect((screen.getByLabelText('永久额度（覆盖等级默认）') as HTMLInputElement).value).toBe('18000');
    });
    expect(screen.getByText('+临')).toBeInTheDocument();

    cleanup();

    render(
      <UserRow
        user={updatedUser}
        layout="compact"
        onUpdate={vi.fn()}
        showEditButton
        canWriteCustomers
        canWriteTier
        canWriteCredit
      />,
    );

    expect(screen.getByText('+临')).toBeInTheDocument();
    expect(screen.getByTitle('调整授信额度')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('调整授信额度'));
    expect(screen.getByText(/授信额度与账期调整/)).toBeInTheDocument();

    cleanup();

    render(
      <table>
        <tbody>
          <UserRow
            user={{ ...user, role: 'admin', tier: '璞玉' }}
            onUpdate={vi.fn()}
            showEditButton={false}
          />
        </tbody>
      </table>,
    );
    expect(screen.getByText('管理员')).toBeInTheDocument();
    expect(screen.queryByText('璞玉')).toBeNull();
  });

  it('removes desktop table horizontal clipping on /admin/users and auto-opens credit editor from query params', async () => {
    window.history.replaceState({}, '', '/admin/users?q=61216888@qq.com&creditUserId=usr_target');

    const targetUser = {
      id: 'usr_target',
      email: '61216888@qq.com',
      name: '靶向客户',
      phone: null,
      company: '测试单位',
      role: 'customer',
      tier: '璞玉',
      isFrozen: false,
      frozenReason: null,
      notes: null,
      discountOverride: null,
      points: 0,
      balance: 0,
      createdAt: '2026-11-01T00:00:00.000Z',
      lastLoginAt: null,
      creditSummary: baseSummary,
    };

    let savedOverride = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/admin/access')) {
          return makeJsonResponse({
            permissions: ['customers.write', 'pricing.write', 'finance.write'],
          });
        }
        if (url === '/api/admin/users/usr_target/credit' && init?.method === 'PATCH') {
          savedOverride = true;
          return makeJsonResponse({
            account: {
              ...baseSummary,
              overrideLimit: 16000,
              permanentLimit: 16000,
              effectiveLimit: 16000,
              availableAmount: 16000,
              hasAccount: true,
            },
          });
        }
        if (url.startsWith('/api/users')) {
          return makeJsonResponse({
            users: [
              savedOverride
                ? {
                    ...targetUser,
                    creditSummary: {
                      ...baseSummary,
                      overrideLimit: 16000,
                      permanentLimit: 16000,
                      effectiveLimit: 16000,
                      availableAmount: 16000,
                      hasAccount: true,
                    },
                  }
                : targetUser,
            ],
            total: 1,
            page: 1,
            limit: 20,
            totalPages: 1,
          });
        }
        if (url.startsWith('/api/admin/discount-templates')) {
          return makeJsonResponse([]);
        }
        return makeJsonResponse({});
      }),
    );

    const { container } = render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/授信额度与账期调整/).length).toBeGreaterThan(0);
    });

    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.className).not.toContain('min-w-[1240px]');
    expect(container.querySelectorAll('thead th')).toHaveLength(7);
    for (const heading of ['用户 / 邮箱', '机构 / 电话', '状态 / 等级', '授信额度', '登录 / 注册', '操作']) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    const saveCreditBtn = screen.getByRole('button', { name: '保存授信' });
    expect(saveCreditBtn.closest('td')).toHaveAttribute('colspan', '7');

    // Wait for /api/admin/access permissions so finance.write inputs/save button become enabled
    await waitFor(() => {
      expect(saveCreditBtn).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText('永久额度（覆盖等级默认）'), { target: { value: '16000' } });
    fireEvent.click(saveCreditBtn);

    // After save + silent refresh, feedback renders, editor closes cleanly and stays closed, and table cell shows ¥16,000
    expect(await screen.findByText('授信已更新')).toBeInTheDocument();
    expect(screen.queryByText(/授信额度与账期调整/)).toBeNull();
    expect(await screen.findByText('¥16,000')).toBeInTheDocument();
  });

  it('shows 超授信待审 and the Chinese credit error after reviewing either acceptance preview', async () => {
    const customerEmail = '61216888@qq.com';
    const acceptance: MerchantOrderApprovalPreview = {
      version: 'a'.repeat(64),
      action: 'accept_order',
      snapshot: {
        orderId: 'ORD-OVER-001', inquiryId: null, organizationId: null, ownerScope: 'personal',
        customerId: 'usr_target', customerEmail, payee: 'Libereal', paymentMethod: 'rjmart',
        subtotal: 13230, total: 13230, adjustmentTotal: 0, pointsDiscount: 0, status: 'pending',
        recipient: null, paidAt: null, alipay: null, adjustments: [],
        credit: {
          debtorId: 'usr_target', paymentTermDays: 30, effectiveLimit: 5000, availableAmount: 5000,
          status: 'active', receivable: null,
        },
        lines: [{
          id: 'order-line-1', productId: null, variantId: null, name: '测试抗体',
          brand: null, catalogNumber: null, spec: null, unit: null, quantity: 1, unitPrice: 13230,
          leadTime: null, conditions: null,
        }],
      },
    };
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/orders/ORD-OVER-001/quote' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({ action: 'accept_order', approvalVersion: acceptance.version });
        return makeJsonResponse({ error: 'CREDIT_LIMIT_EXCEEDED' }, 409);
      }
      if (
        (url === '/api/admin/orders/ORD-OVER-001' || url === '/api/orders/ORD-OVER-001')
        && init?.method === 'PATCH'
      ) {
        const body = JSON.parse(String(init.body || '{}')) as { status?: string };
        if (body.status === 'confirmed') {
          expect(body).toMatchObject({ action: 'accept_order', approvalVersion: acceptance.version });
          return makeJsonResponse({ error: 'CREDIT_LIMIT_EXCEEDED' }, 409);
        }
        return makeJsonResponse({ ok: true });
      }
      if (url.startsWith('/api/admin/orders/ORD-OVER-001')) {
        return makeJsonResponse({
          order: {
            id: 'ORD-OVER-001',
            name: '张工',
            email: customerEmail,
            phone: '13800138000',
            institution: '测试高校',
            status: 'pending',
            subtotal: 13230,
            total: 13230,
            paymentMethod: 'rjmart',
            createdAt: '2026-11-22T01:00:00.000Z',
            items: acceptance.snapshot.lines.map(({ unitPrice, ...line }) => ({ ...line, price: unitPrice })),
            approvalPreview: acceptance,
            events: [],
            creditReview: {
              userId: 'usr_target',
              tier: '璞玉',
              orderTotal: 13230,
              paymentMethod: 'rjmart',
              flaggedAtSubmission: true,
              needsReview: true,
              suspended: false,
              exceedsLimit: true,
              shortfall: 8230,
              summary: baseSummary,
            },
          },
        });
      }
      if (url.startsWith('/api/admin/orders')) {
        return makeJsonResponse({
          orders: [
            {
              id: 'ORD-OVER-001',
              name: '张工',
              email: customerEmail,
              phone: '13800138000',
              institution: '测试高校',
              status: 'pending',
              subtotal: 13230,
              total: 13230,
              paymentMethod: 'rjmart',
              createdAt: '2026-11-22T01:00:00.000Z',
              items: [],
              creditReview: {
                needsReview: true,
                flaggedAtSubmission: true,
                suspended: false,
                exceedsLimit: true,
                shortfall: 8230,
                availableAmount: 5000,
                effectiveLimit: 5000,
              },
            },
          ],
          total: 1,
          statusCounts: { pending: 1 },
        });
      }
      if (url.startsWith('/api/admin/access') || url.startsWith('/api/admin/permissions/me')) {
        return makeJsonResponse({
          permissions: ['orders.read', 'orders.write', 'finance.write'],
        });
      }
      return makeJsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);

    expect((await screen.findAllByText('ORD-OVER-001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('超授信待审').length).toBeGreaterThan(0);

    // Expand order row
    fireEvent.click(screen.getAllByText('ORD-OVER-001')[0]!);

    const reviewSections = await screen.findAllByRole('region', { name: '订单授信人工审批' });
    const reviewSection = reviewSections[0]!;
    expect(reviewSection).toBeInTheDocument();
    const userLink = within(reviewSection).getByRole('link', { name: '去用户管理查看' });
    expect(userLink).toHaveAttribute('href', '/admin/users?q=61216888%40qq.com&creditUserId=usr_target');

    // Toggle inline CustomerCreditEditor
    fireEvent.click(within(reviewSection).getByRole('button', { name: '调整永久 / 临时额度' }));
    expect(within(reviewSection).getByText(/授信额度与账期调整/)).toBeInTheDocument();

    fireEvent.click(within(reviewSection).getByRole('button', { name: '收起调额面板' }));
    expect(within(reviewSection).queryByText(/授信额度与账期调整/)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '核对接单明细' })[0]!);
    const acceptancePanel = within((await screen.findAllByRole('region', { name: '订单确认明细' }))[0]!);
    expect(acceptancePanel.getByText(/测试抗体.*× 1/)).toBeInTheDocument();
    expect(acceptancePanel.getByText(/账期 30 天/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === 'PATCH')).toBe(false);
    fireEvent.click(acceptancePanel.getByRole('button', { name: '确认 Libereal 接单' }));
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([u, opts]) =>
          (String(u) === '/api/admin/orders/ORD-OVER-001' || String(u) === '/api/orders/ORD-OVER-001')
          && opts?.method === 'PATCH',
      );
      expect(patches).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/客户可用授信额度不足，无法确认接单/).length).toBeGreaterThanOrEqual(1);
    });
    expect(alertSpy).not.toHaveBeenCalledWith('CREDIT_LIMIT_EXCEEDED');

    fireEvent.click(screen.getAllByRole('button', { name: '核对接单并通知客户' })[0]!);
    const notifyPanel = within((await screen.findAllByRole('region', { name: '订单确认明细' }))[0]!);
    expect(notifyPanel.getByText(/订单合计.*13,230/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false);
    fireEvent.click(notifyPanel.getByRole('button', { name: '确认接单并通知客户' }));
    await waitFor(() => {
      const quoteCalls = fetchMock.mock.calls.filter(
        ([u, opts]) => String(u) === '/api/orders/ORD-OVER-001/quote' && opts?.method === 'POST',
      );
      expect(quoteCalls).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/客户可用授信额度不足，无法确认接单/).length).toBeGreaterThanOrEqual(1);
    });
    expect(alertSpy).not.toHaveBeenCalledWith('CREDIT_LIMIT_EXCEEDED');
  });

  it('shows 待授信审核 on /account/orders for pending credit review orders and clears it on cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/orders' && !init?.method) {
          return makeJsonResponse([
            {
              id: 'ORD-CUST-1',
              inquiryId: 'INQ-1',
              email: 'buyer@test.com',
              userName: '张工',
              userInstitution: '测试高校',
              userPhone: '13800138000',
              userDepartment: '生科院',
              items: [{ name: '测试试剂', price: 13230, quantity: 1 }],
              subtotal: 13230,
              adjustmentTotal: 0,
              total: 13230,
              status: 'pending',
              creditReviewPending: true,
              paymentMethod: 'rjmart',
              adjustments: [],
              shipments: [],
              createdAt: '2026-11-22T01:00:00.000Z',
              updatedAt: '2026-11-22T01:00:00.000Z',
            },
          ]);
        }
        if (url === '/api/orders/ORD-CUST-1' && init?.method === 'PATCH') {
          return makeJsonResponse({ success: true });
        }
        return makeJsonResponse({});
      }),
    );

    render(<AccountOrdersPage />);

    expect((await screen.findAllByText('待授信审核')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getAllByRole('button', { name: /详情/ })[0]!);
    expect((await screen.findAllByText(/订单已提交，待人工授信审核/)).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getAllByRole('button', { name: /取消订单/ })[0]!);
    await waitFor(() => {
      expect(screen.queryByText('待授信审核')).toBeNull();
    });
    expect(screen.queryByText(/订单已提交，待人工授信审核/)).toBeNull();
  });
});
