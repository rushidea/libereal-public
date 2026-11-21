export type CustomerCreditSummary = {
  tierDefaultLimit: number;
  baseLimit: number;
  overrideLimit: number | null;
  permanentLimit: number;
  temporaryLimit: number;
  temporaryUntil: string | null;
  activeTemporaryLimit: number;
  effectiveLimit: number;
  usedAmount: number;
  availableAmount: number;
  status: string;
  paymentTermDays: number;
  hasAccount: boolean;
};

export type OrderCreditReviewBadge = {
  needsReview: boolean;
  flaggedAtSubmission: boolean;
  suspended: boolean;
  exceedsLimit: boolean;
  shortfall: number;
  availableAmount: number;
  effectiveLimit: number;
};

export type OrderCreditReviewSummary = {
  userId: string;
  tier: string;
  orderTotal: number;
  paymentMethod: string | null;
  flaggedAtSubmission: boolean;
  needsReview: boolean;
  suspended: boolean;
  exceedsLimit: boolean;
  shortfall: number;
  summary: CustomerCreditSummary;
};

export const CREDIT_STATUS_LABELS: Record<string, string> = {
  active: '正常',
  credit_limited: '限额下单',
  paused: '暂停授信',
  overdue_hold: '逾期暂停',
};

export type CreditAccountLite = {
  baseLimit: number;
  overrideLimit?: number | null;
  temporaryLimit: number;
  temporaryUntil?: string | null;
  usedAmount: number;
  status: string;
  paymentTermDays: number;
};

export function creditSummaryFromUser(
  user: {
    tier?: string | null;
    creditAccount?: CreditAccountLite | null;
    creditSummary?: CustomerCreditSummary | null;
  },
  now = new Date(),
): CustomerCreditSummary {
  if (user.creditSummary) return user.creditSummary;
  const account = user.creditAccount;
  const baseLimit = account?.baseLimit ?? 0;
  const overrideLimit = account?.overrideLimit ?? null;
  const permanentLimit = overrideLimit ?? baseLimit;
  const temporaryLimit = account?.temporaryLimit ?? 0;
  const temporaryUntilDate = account?.temporaryUntil ? new Date(account.temporaryUntil) : null;
  const validTemporaryUntil = temporaryUntilDate && !Number.isNaN(temporaryUntilDate.getTime())
    ? temporaryUntilDate
    : null;
  const activeTemporaryLimit = validTemporaryUntil && validTemporaryUntil >= now ? temporaryLimit : 0;
  const status = account?.status ?? 'active';
  const rawEffective = permanentLimit + activeTemporaryLimit;
  const effectiveLimit = status === 'credit_limited' ? Math.min(rawEffective, 5_000) : rawEffective;
  const usedAmount = Math.round(((account?.usedAmount ?? 0) + Number.EPSILON) * 100) / 100;
  const availableAmount = Math.round(((effectiveLimit - usedAmount) + Number.EPSILON) * 100) / 100;
  return {
    tierDefaultLimit: baseLimit,
    baseLimit,
    overrideLimit,
    permanentLimit,
    temporaryLimit,
    temporaryUntil: validTemporaryUntil ? validTemporaryUntil.toISOString() : null,
    activeTemporaryLimit,
    effectiveLimit,
    usedAmount,
    availableAmount,
    status,
    paymentTermDays: account?.paymentTermDays ?? 30,
    hasAccount: Boolean(account),
  };
}

export function validateCreditDraftInput(input: {
  creditOverride: string;
  temporaryLimit: string;
  temporaryUntil: string;
  paymentTermDays: string;
  creditStatus: string;
}):
  | {
      ok: true;
      payload: {
        overrideLimit: number | null;
        temporaryLimit: number;
        temporaryUntil: string | null;
        status: string;
        paymentTermDays: number;
      };
    }
  | { ok: false; error: string } {
  const overrideTrimmed = input.creditOverride.trim();
  const overrideLimit = overrideTrimmed === '' ? null : Number(overrideTrimmed);
  if (overrideLimit !== null && (!Number.isFinite(overrideLimit) || overrideLimit < 0)) {
    return { ok: false, error: '永久额度需为大于或等于 0 的数字。' };
  }
  const temporaryTrimmed = input.temporaryLimit.trim();
  const temporaryLimit = temporaryTrimmed === '' ? 0 : Number(temporaryTrimmed);
  if (!Number.isFinite(temporaryLimit) || temporaryLimit < 0) {
    return { ok: false, error: '临时额度需为大于或等于 0 的数字。' };
  }
  const temporaryUntil = input.temporaryUntil.trim() || null;
  if (temporaryLimit > 0 && !temporaryUntil) {
    return { ok: false, error: '填写临时额度后，必须选择到期日（到期日当天 23:59 前有效）。' };
  }
  const paymentTermDays = Number(input.paymentTermDays.trim() || '30');
  if (!Number.isInteger(paymentTermDays) || paymentTermDays < 1 || paymentTermDays > 365) {
    return { ok: false, error: '账期需为 1 到 365 之间的整数天。' };
  }
  if (!['active', 'credit_limited', 'paused', 'overdue_hold'].includes(input.creditStatus)) {
    return { ok: false, error: '请选择有效的授信状态。' };
  }
  return {
    ok: true,
    payload: {
      overrideLimit,
      temporaryLimit,
      temporaryUntil: temporaryLimit === 0 ? null : temporaryUntil,
      status: input.creditStatus,
      paymentTermDays,
    },
  };
}

export function previewEffectiveCreditLimit(
  tierOrBaseLimit: number,
  draft: {
    creditOverride: string;
    temporaryLimit: string;
    temporaryUntil: string;
    creditStatus: string;
  },
): number {
  const overrideRaw = draft.creditOverride.trim();
  const parsedOverride = overrideRaw === '' ? null : Number(overrideRaw);
  const permanent = parsedOverride !== null && Number.isFinite(parsedOverride) && parsedOverride >= 0
    ? parsedOverride
    : tierOrBaseLimit;
  const parsedTemp = Number(draft.temporaryLimit.trim() || '0');
  const activeTemp = Number.isFinite(parsedTemp) && parsedTemp > 0 && draft.temporaryUntil.trim()
    ? parsedTemp
    : 0;
  const raw = Math.round((permanent + activeTemp + Number.EPSILON) * 100) / 100;
  return draft.creditStatus === 'credit_limited' ? Math.min(raw, 5_000) : raw;
}

export function isOrderCreditReviewSummary(value: unknown): value is OrderCreditReviewSummary {
  return Boolean(
    value
    && typeof value === 'object'
    && 'summary' in value
    && (value as { summary?: unknown }).summary
    && typeof (value as { summary?: unknown }).summary === 'object',
  );
}

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatCreditDateForInput(value?: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

export function addDaysToShanghaiDate(days: number, now = new Date()): string {
  const today = formatCreditDateForInput(now);
  if (!today) return '';
  const anchor = new Date(`${today}T12:00:00.000+08:00`);
  if (Number.isNaN(anchor.getTime())) return '';
  anchor.setTime(anchor.getTime() + days * 86400000);
  return formatCreditDateForInput(anchor);
}

const REFRESHABLE_QUOTE_ERROR_CODES = new Set([
  'QUOTE_STALE',
  'QUOTE_EXPIRED',
  'QUOTE_NOT_ACTIONABLE',
  'QUOTE_VERSION_CONFLICT',
  'QUOTE_REPRICE_REQUIRED',
  'INSUFFICIENT_STOCK',
]);

const NON_REFRESHABLE_CREDIT_ERROR_CODES = new Set([
  'CREDIT_ACCOUNT_SUSPENDED',
  'CREDIT_LIMIT_EXCEEDED',
]);

export function formatQuoteConfirmError(
  err: { error?: unknown; detail?: unknown; code?: unknown },
  status: number,
): string {
  const code = typeof err.code === 'string' ? err.code : '';
  const detailText = typeof err.detail === 'string' && err.detail.trim() ? err.detail.trim() : '';
  const errorText = typeof err.error === 'string' && err.error.trim() ? err.error.trim() : '';

  if (NON_REFRESHABLE_CREDIT_ERROR_CODES.has(code)) {
    return errorText || detailText || '授信账户当前不可用';
  }

  const withRefreshHint = (message: string) => (
    /请刷新后重新核对[。！]?$/.test(message) ? message : `${message} 请刷新后重新核对。`
  );

  if (code) {
    if (REFRESHABLE_QUOTE_ERROR_CODES.has(code)) {
      return withRefreshHint(errorText || detailText || '报价状态已变化');
    }
    return errorText || detailText || '提交失败';
  }

  if (status === 400 || status === 409) {
    return withRefreshHint(detailText || errorText || '报价状态已变化');
  }

  return detailText || errorText || '提交失败';
}
