import { CREDIT_REVIEW_POLICY, overdueDaysFromDueAt, overdueReceivableWhere, receivableReminderKey } from '@/lib/customer-credit';
import { receivableOrderBalance, receivableOutstandingCents } from '@/lib/receivable-balance';
import type { BackgroundTask } from '@prisma/client';
import { sendAliyunSmsTemplate } from '@/lib/aliyun-sms';
import { parseTaskPayload } from '@/lib/background-tasks';
import { sendMail, sendQuoteNotificationEmailNow, type MailMessage } from '@/lib/mail';
import { prisma } from '@/lib/prisma';
import { settleExpiredQuotes } from '@/lib/quote-expiry-settle';
import { runMfaChallengeCleanupOnce } from '@/lib/security/mfa-cleanup';
import { dispatchApprovedBusinessLetter } from '@/lib/business-letters';

type SmsPayload = { phone: string; templateCode: string; templateParams: Record<string, string | number> };
type QuoteNotificationPayload = {
  kind: 'quote';
  to: string;
  subject: string;
  message: string;
  path: string;
  headline?: string;
  callout?: string;
};
type EmailPayload = MailMessage | QuoteNotificationPayload | { kind: 'business_letter'; draftId: string };
type OrderReminderPayload = { receivableId: string; reminderAt?: string; dueAt?: string };
type QuoteExpirePayload = { quoteId: string };

async function sendEmail(task: BackgroundTask): Promise<unknown> {
  const payload = parseTaskPayload<EmailPayload>(task);
  if ('kind' in payload && payload.kind === 'business_letter') {
    // No raw message or claimed approval from the task payload is trusted.
    const letter = await dispatchApprovedBusinessLetter(payload.draftId);
    if (letter.status !== 'accepted') throw new Error(`Business letter ${letter.status}; inspect its persistent record before further action`);
    return { draftId: letter.id, status: letter.status, receipt: letter.result };
  }
  const result = 'kind' in payload && payload.kind === 'quote'
    ? await sendQuoteNotificationEmailNow(payload)
    : await sendMail(payload as MailMessage);
  if (!result.ok) throw new Error(result.error || `Mail provider ${result.provider} failed`);
  return result;
}

async function sendSms(task: BackgroundTask): Promise<unknown> {
  const payload = parseTaskPayload<SmsPayload>(task);
  await sendAliyunSmsTemplate(payload.phone, payload.templateCode, payload.templateParams);
  return { sent: true };
}

async function sendOrderReminder(task: BackgroundTask): Promise<unknown> {
  const payload = parseTaskPayload<OrderReminderPayload>(task);
  const now = new Date();
  const current = await prisma.$transaction(async tx => {
    const receivable = await tx.accountReceivable.findFirst({
      where: { ...overdueReceivableWhere(now), id: payload.receivableId },
      include: {
        user: { select: { email: true, phone: true } },
        order: { select: { ...receivableOrderBalance, id: true, ownerScope: true, organization: { select: { owner: { select: { email: true } } } } } },
      },
    });
    if (!receivable?.dueAt || !receivable.lastReminderAt || task.dedupeKey !== receivableReminderKey(receivable.id, receivable.lastReminderAt)
      || payload.reminderAt && payload.reminderAt !== receivable.lastReminderAt.toISOString()
      || payload.dueAt && payload.dueAt !== receivable.dueAt.toISOString()) return null;
    const overdueDays = overdueDaysFromDueAt(receivable.dueAt, now);
    const balance = receivableOutstandingCents(receivable.amount, receivable.status, receivable.order.cashPostings, receivable.order.total);
    if (balance <= 0 || overdueDays < CREDIT_REVIEW_POLICY.reminderAfterDays) return null;
    return { receivable, overdueDays, amount: (balance / 100).toFixed(2) };
  });
  if (!current) return { skipped: 'receivable_reminder_no_longer_due' };

  const { receivable, overdueDays, amount } = current;
  const message = `订单 ${receivable.order.id} 应付款 ¥${amount} 已超过 ${overdueDays} 天，请及时完成付款。`;
  const recipients = new Set([receivable.user.email]);
  if (receivable.order.ownerScope === 'organization' && receivable.order.organization?.owner.email) {
    recipients.add(receivable.order.organization.owner.email);
  }
  const mailResults = await Promise.all(Array.from(recipients, (to) => sendMail({ to, subject: 'LIBEREAL · 应付款提醒', text: message })));
  const failedMail = mailResults.find((result) => !result.ok);
  if (failedMail && !failedMail.ok) throw new Error(failedMail.error || 'Credit reminder email failed');

  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE_CREDIT_REMINDER;
  if (templateCode && receivable.user.phone) {
    await sendAliyunSmsTemplate(receivable.user.phone, templateCode, {
      orderId: receivable.order.id,
      amount,
      days: overdueDays,
    });
  }
  return { email: true, recipients: recipients.size, sms: Boolean(templateCode && receivable.user.phone) };
}

async function expireQuote(task: BackgroundTask): Promise<unknown> {
  const { quoteId } = parseTaskPayload<QuoteExpirePayload>(task);
  const now = new Date();
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { id: true, status: true, validUntil: true, inquiryId: true },
  });
  if (!quote) return { skipped: 'quote_inactive' };
  if (quote.status === 'expired') {
    await settleExpiredQuotes(prisma, [quote.inquiryId], now);
    return { skipped: 'quote_inactive' };
  }
  if (quote.status !== 'sent') return { skipped: 'quote_inactive' };
  if (!quote.validUntil) return { skipped: 'quote_has_no_expiration' };
  if (quote.validUntil > now) throw new Error('Quote expiration task ran before validUntil');

  await settleExpiredQuotes(prisma, [quote.inquiryId], now);
  return { expired: true, quoteId };
}

export async function executeBackgroundTask(task: BackgroundTask): Promise<unknown> {
  switch (task.type) {
    case 'email.send': return sendEmail(task);
    case 'sms.send': return sendSms(task);
    case 'order.reminder': return sendOrderReminder(task);
    case 'quote.expire': return expireQuote(task);
    case 'search.index_update': {
      const refreshedAt = new Date();
      await prisma.transientEntry.upsert({
        where: { key: 'search:index-version' },
        create: { key: 'search:index-version', value: refreshedAt.toISOString(), expiresAt: new Date('2999-12-31T00:00:00.000Z') },
        update: { value: refreshedAt.toISOString(), expiresAt: new Date('2999-12-31T00:00:00.000Z') },
      });
      return { source: 'database', refreshedAt: refreshedAt.toISOString() };
    }
    case 'news.update': return { skipped: 'news_module_not_deployed' };
    case 'security.mfa_cleanup': return runMfaChallengeCleanupOnce();
    default: throw new Error(`Unsupported background task type: ${task.type}`);
  }
}
