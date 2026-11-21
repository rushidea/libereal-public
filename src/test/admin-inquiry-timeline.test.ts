import { describe, expect, it } from 'vitest';
import {
  buildAdminInquiryTimeline,
  buildCurrentActionAlert,
  buildInquiryProgressSteps,
  parseInquiryOperationLogs,
  type AdminInquiryRecord,
  type TimelineSupplierEntry,
} from '@/lib/admin-inquiry-timeline';
import type { AdminFeedbackView } from '@/lib/inquiry-feedback';

function makeInquiry(overrides: Partial<AdminInquiryRecord> = {}): AdminInquiryRecord {
  return {
    id: 'inq_timeline_1',
    name: '张三',
    email: 'zhangsan@lab.edu.cn',
    phone: '13800138000',
    institution: '示例大学',
    items: [
      {
        id: 'item_1',
        name: '高纯试剂 A',
        brand: 'Sigma',
        catalogNumber: 'SIG-001',
        quantity: 2,
        price: 500,
        customerLeadTime: '7天内',
      },
    ],
    subtotal: 1000,
    status: 'pending_quote',
    createdAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeFeedback(overrides: Partial<AdminFeedbackView> = {}): AdminFeedbackView {
  return {
    id: 'fb_1',
    inquiryId: 'inq_timeline_1',
    quoteId: 'q_1',
    quoteVersion: 1,
    actorType: 'customer',
    actorUserId: 'user_1',
    actorEmail: 'zhangsan@lab.edu.cn',
    actorName: '张三',
    channel: 'website',
    channelReference: null,
    feedbackType: 'price_negotiation',
    content: '希望再优惠 5%',
    handlingStatus: 'pending',
    handledByAdminId: null,
    handledByAdminEmail: null,
    handledAt: null,
    resolutionNote: null,
    resolvedByQuoteId: null,
    clientRequestId: null,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

function makeSupplierEntry(overrides: Partial<TimelineSupplierEntry> = {}): TimelineSupplierEntry {
  return {
    inquiryItemId: 'item_1',
    name: '高纯试剂 A',
    reviewId: 'rev_1',
    status: 'awaiting_human',
    owner: 'buyer@libereal.test',
    requestedAt: '2026-11-01T09:00:00.000Z',
    confirmedAt: null,
    scope: {
      catalogNumber: 'SIG-001',
      brand: 'Sigma',
      quantity: 2,
      cataloguePrice: 600,
      currency: 'CNY',
      customerPricing: { finalPrice: 500, steps: [{ reason: '品牌折扣' }] },
    },
    reply: null,
    ...overrides,
  };
}

describe('admin inquiry timeline module', () => {
  it('orders newest events on top by default (desc) and oldest on top when asc', () => {
    const inquiry = makeInquiry({
      status: 'quote_sent',
      createdAt: '2026-11-01T08:00:00.000Z',
      activeQuote: {
        id: 'q_1',
        version: 1,
        status: 'sent',
        subtotal: 1000,
        sentAt: '2026-11-01T10:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', name: '高纯试剂 A', price: 500, quantity: 2 }],
      },
    });
    const supplierEntries = [
      makeSupplierEntry({
        status: 'succeeded',
        requestedAt: '2026-11-01T09:00:00.000Z',
        confirmedAt: '2026-11-01T09:30:00.000Z',
        reply: {
          supplier: '星光试剂',
          channel: '邮件',
          reference: 'Mail #42',
          supplierUnitPrice: 380,
          customerUnitPrice: 500,
          currency: 'CNY',
          taxBasis: 'included',
          leadTime: '5天',
          validUntil: '2026-12-01T00:00:00.000Z',
          conditions: '月结30天',
          customerConditions: '含税包邮',
        },
      }),
    ];
    const feedbacks = [makeFeedback({ createdAt: '2026-11-01T11:00:00.000Z' })];
    const now = new Date('2026-11-15T00:00:00.000Z');

    const descEvents = buildAdminInquiryTimeline({ inquiry, supplierEntries, feedbacks, now });
    expect(descEvents.map((e) => e.type)).toEqual([
      'customer_feedback',
      'quote_version',
      'supplier_quote_replied',
      'supplier_quote_prepared',
      'inquiry_created',
    ]);

    const ascEvents = buildAdminInquiryTimeline({
      inquiry,
      supplierEntries,
      feedbacks,
      sortOrder: 'asc',
      now,
    });
    expect(ascEvents.map((e) => e.type)).toEqual([
      'inquiry_created',
      'supplier_quote_prepared',
      'supplier_quote_replied',
      'quote_version',
      'customer_feedback',
    ]);
  });

  it('tie-breaks matching timestamps by causalOrder in both desc and asc', () => {
    const sameTime = '2026-11-01T10:00:00.000Z';
    const inquiry = makeInquiry({
      createdAt: sameTime,
      status: 'quote_sent',
      activeQuote: {
        id: 'q_tie',
        version: 1,
        status: 'sent',
        subtotal: 1000,
        sentAt: sameTime,
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', name: '高纯试剂 A', price: 500, quantity: 2 }],
      },
    });
    const supplierEntries = [
      makeSupplierEntry({
        status: 'succeeded',
        requestedAt: sameTime,
        confirmedAt: sameTime,
        reply: {
          supplier: '星光试剂',
          channel: '邮件',
          reference: 'Mail #99',
          supplierUnitPrice: 380,
          customerUnitPrice: 500,
          currency: 'CNY',
          taxBasis: 'included',
          leadTime: '5天',
          validUntil: '2026-12-01T00:00:00.000Z',
          conditions: '内部条款',
          customerConditions: '客户条款',
        },
      }),
    ];
    const feedbacks = [makeFeedback({ createdAt: sameTime })];
    const now = new Date('2026-11-15T00:00:00.000Z');

    const desc = buildAdminInquiryTimeline({ inquiry, supplierEntries, feedbacks, sortOrder: 'desc', now });
    expect(desc.map((e) => e.category)).toEqual([
      'feedback',
      'quote',
      'supplier',
      'supplier',
      'inquiry',
    ]);
    expect(desc.map((e) => e.type)).toEqual([
      'customer_feedback',
      'quote_version',
      'supplier_quote_replied',
      'supplier_quote_prepared',
      'inquiry_created',
    ]);

    const asc = buildAdminInquiryTimeline({ inquiry, supplierEntries, feedbacks, sortOrder: 'asc', now });
    expect(asc.map((e) => e.category)).toEqual([
      'inquiry',
      'supplier',
      'supplier',
      'quote',
      'feedback',
    ]);
    expect(asc.map((e) => e.type)).toEqual([
      'inquiry_created',
      'supplier_quote_prepared',
      'supplier_quote_replied',
      'quote_version',
      'customer_feedback',
    ]);
  });

  it('attaches matching operationLogs 1-to-1 into quote_version and preserves unmatched logs as quote_operation_log', () => {
    const operationLogs = JSON.stringify([
      { historicalFailure: 'preserve' },
      {
        adminEmail: 'legacy@libereal.test',
        time: '2026-11-01T08:30:00.000Z',
        items: [{ name: '高纯试剂 A', price: 520, quantity: 2, leadTime: '14天' }],
      },
      {
        adminEmail: 'sales@libereal.test',
        time: '2026-11-01T10:00:30.000Z',
        items: [{ name: '高纯试剂 A', price: 500, quantity: 2, leadTime: '10天' }],
      },
      {
        adminEmail: 'sales2@libereal.test',
        time: '2026-11-01T10:01:25.000Z',
        items: [{ name: '高纯试剂 A', price: 480, quantity: 2, leadTime: '7天' }],
      },
    ]);

    expect(parseInquiryOperationLogs(operationLogs)).toHaveLength(3);
    expect(parseInquiryOperationLogs('not-json')).toEqual([]);

    const inquiry = makeInquiry({
      status: 'quote_sent',
      operationLogs,
      quoteVersions: [
        {
          id: 'q_2',
          version: 2,
          status: 'sent',
          subtotal: 960,
          sentAt: '2026-11-01T10:01:20.000Z',
          validUntil: '2026-12-01T00:00:00.000Z',
          items: [{ id: 'qi_2', name: '高纯试剂 A', price: 480, quantity: 2 }],
        },
        {
          id: 'q_1',
          version: 1,
          status: 'superseded',
          subtotal: 1000,
          sentAt: '2026-11-01T10:00:25.000Z',
          validUntil: '2026-12-01T00:00:00.000Z',
          items: [{ id: 'qi_1', name: '高纯试剂 A', price: 500, quantity: 2 }],
        },
      ],
      activeQuote: {
        id: 'q_2',
        version: 2,
        status: 'sent',
        subtotal: 960,
        sentAt: '2026-11-01T10:01:20.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_2', name: '高纯试剂 A', price: 480, quantity: 2 }],
      },
    });

    const events = buildAdminInquiryTimeline({
      inquiry,
      now: new Date('2026-11-15T00:00:00.000Z'),
    });

    const q1 = events.find((e) => e.id === 'quote_version:q_1');
    const q2 = events.find((e) => e.id === 'quote_version:q_2');
    const legacyLogs = events.filter((e) => e.type === 'quote_operation_log');

    expect(q1?.type).toBe('quote_version');
    if (q1?.type === 'quote_version') {
      expect(q1.operationLog?.adminEmail).toBe('sales@libereal.test');
    }
    expect(q2?.type).toBe('quote_version');
    if (q2?.type === 'quote_version') {
      expect(q2.operationLog?.adminEmail).toBe('sales2@libereal.test');
    }
    expect(legacyLogs).toHaveLength(1);
    if (legacyLogs[0]?.type === 'quote_operation_log') {
      expect(legacyLogs[0].log.adminEmail).toBe('legacy@libereal.test');
      expect(legacyLogs[0].defaultExpanded).toBe(false);
    }
  });

  it('applies smart collapse defaults across quotes, feedbacks, and supplier entries', () => {
    const now = new Date('2026-11-15T00:00:00.000Z');
    const inquiry = makeInquiry({
      status: 'quote_sent',
      quoteVersions: [
        {
          id: 'q_active',
          version: 3,
          status: 'sent',
          subtotal: 900,
          sentAt: '2026-11-10T10:00:00.000Z',
          validUntil: '2026-12-01T00:00:00.000Z',
          items: [{ id: 'qi_3', name: '高纯试剂 A', price: 450, quantity: 2 }],
        },
        {
          id: 'q_expired',
          version: 2,
          status: 'expired',
          subtotal: 950,
          sentAt: '2026-11-05T10:00:00.000Z',
          validUntil: '2026-11-08T00:00:00.000Z',
          items: [{ id: 'qi_2', name: '高纯试剂 A', price: 475, quantity: 2 }],
        },
        {
          id: 'q_superseded',
          version: 1,
          status: 'superseded',
          subtotal: 1000,
          sentAt: '2026-11-02T10:00:00.000Z',
          validUntil: '2026-12-01T00:00:00.000Z',
          items: [{ id: 'qi_1', name: '高纯试剂 A', price: 500, quantity: 2 }],
        },
      ],
      activeQuote: {
        id: 'q_active',
        version: 3,
        status: 'sent',
        subtotal: 900,
        sentAt: '2026-11-10T10:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_3', name: '高纯试剂 A', price: 450, quantity: 2 }],
      },
    });

    const supplierEntries: TimelineSupplierEntry[] = [
      makeSupplierEntry({
        inquiryItemId: 'item_done',
        reviewId: 'rev_done',
        status: 'succeeded',
        requestedAt: '2026-11-01T09:00:00.000Z',
        confirmedAt: '2026-11-01T09:30:00.000Z',
        reply: {
          supplier: '供应商甲',
          channel: '邮件',
          reference: 'Mail #1',
          supplierUnitPrice: 350,
          customerUnitPrice: 450,
          currency: 'CNY',
          taxBasis: 'included',
          leadTime: '5天',
          validUntil: '2026-12-01T00:00:00.000Z',
          conditions: '内部',
          customerConditions: '外部',
        },
      }),
      makeSupplierEntry({
        inquiryItemId: 'item_wait',
        reviewId: 'rev_wait',
        status: 'awaiting_human',
        requestedAt: '2026-11-09T09:00:00.000Z',
        confirmedAt: null,
        reply: null,
      }),
    ];

    const feedbacks: AdminFeedbackView[] = [
      makeFeedback({ id: 'fb_pending', handlingStatus: 'pending', createdAt: '2026-11-11T09:00:00.000Z' }),
      makeFeedback({ id: 'fb_resolved', handlingStatus: 'resolved', createdAt: '2026-11-06T09:00:00.000Z' }),
      makeFeedback({ id: 'fb_ignored', handlingStatus: 'ignored', createdAt: '2026-11-04T09:00:00.000Z' }),
    ];

    const events = buildAdminInquiryTimeline({ inquiry, supplierEntries, feedbacks, now });
    const byId = new Map(events.map((e) => [e.id, e]));

    expect(byId.get('quote_version:q_superseded')?.defaultExpanded).toBe(false);
    expect(byId.get('quote_version:q_expired')?.defaultExpanded).toBe(false);
    expect(byId.get('quote_version:q_active')?.defaultExpanded).toBe(true);

    expect(byId.get('customer_feedback:fb_resolved')?.defaultExpanded).toBe(false);
    expect(byId.get('customer_feedback:fb_ignored')?.defaultExpanded).toBe(false);
    expect(byId.get('customer_feedback:fb_pending')?.defaultExpanded).toBe(true);

    expect(byId.get('supplier_quote_prepared:0:item_done:2')?.defaultExpanded).toBe(false);
    expect(byId.get('supplier_quote_replied:0:item_done:2')?.defaultExpanded).toBe(false);
    expect(byId.get('supplier_quote_prepared:1:item_wait:2')?.defaultExpanded).toBe(true);
  });

  it('derives accurate 4-step progress states and action alerts across key business scenarios', () => {
    const now = new Date('2026-11-15T00:00:00.000Z');

    // 1. pending_quote + 免核价
    const pendingNoSupplier = makeInquiry({ status: 'pending_quote' });
    const stepsPending = buildInquiryProgressSteps({ inquiry: pendingNoSupplier, supplierEntries: [], feedbacks: [], now });
    expect(stepsPending.map((s) => [s.label, s.status])).toEqual([
      ['客户发起', 'completed'],
      ['供应商核价', 'skipped'],
      ['报价演进', 'current'],
      ['客户反馈', 'pending'],
    ]);
    expect(stepsPending[1].subtitle).toBe('免核价');
    expect(buildCurrentActionAlert({ inquiry: pendingNoSupplier, supplierEntries: [], feedbacks: [], now })?.target).toBe('action');

    // 2. awaiting supplier
    const awaitingSupplier = makeInquiry({ status: '待人工审核' });
    const waitingEntry = [makeSupplierEntry({ status: 'awaiting_human' })];
    const stepsAwaiting = buildInquiryProgressSteps({ inquiry: awaitingSupplier, supplierEntries: waitingEntry, feedbacks: [], now });
    expect(stepsAwaiting.map((s) => [s.label, s.status])).toEqual([
      ['客户发起', 'completed'],
      ['供应商核价', 'current'],
      ['报价演进', 'pending'],
      ['客户反馈', 'pending'],
    ]);
    expect(buildCurrentActionAlert({ inquiry: awaitingSupplier, supplierEntries: waitingEntry, feedbacks: [], now })?.filterCategory).toBe('supplier');

    // 3. quote_sent + pending feedback
    const quoteSent = makeInquiry({
      status: 'quote_sent',
      activeQuote: {
        id: 'q_sent',
        version: 1,
        status: 'sent',
        subtotal: 1000,
        sentAt: '2026-11-10T10:00:00.000Z',
        validUntil: '2026-12-01T00:00:00.000Z',
        items: [{ id: 'qi_1', name: '高纯试剂 A', price: 500, quantity: 2 }],
      },
    });
    const pendingFb = [makeFeedback({ handlingStatus: 'pending' })];
    const stepsSentFb = buildInquiryProgressSteps({ inquiry: quoteSent, supplierEntries: [], feedbacks: pendingFb, now });
    expect(stepsSentFb.map((s) => [s.label, s.status])).toEqual([
      ['客户发起', 'completed'],
      ['供应商核价', 'skipped'],
      ['报价演进', 'completed'],
      ['客户反馈', 'attention'],
    ]);
    const fbAlert = buildCurrentActionAlert({ inquiry: quoteSent, supplierEntries: [], feedbacks: pendingFb, now });
    expect(fbAlert?.target).toBe('timeline');
    expect(fbAlert?.filterCategory).toBe('feedback');

    // 4. declined
    const declined = makeInquiry({
      status: 'declined',
      activeQuote: {
        id: 'q_dec',
        version: 1,
        status: 'declined',
        subtotal: 1000,
        sentAt: '2026-11-10T10:00:00.000Z',
        declineReasonCode: 'price_high',
        declineNote: '预算不足',
        declinedAt: '2026-11-12T10:00:00.000Z',
        declinedByEmail: 'zhangsan@lab.edu.cn',
        items: [{ id: 'qi_1', name: '高纯试剂 A', price: 500, quantity: 2 }],
      },
    });
    const stepsDeclined = buildInquiryProgressSteps({ inquiry: declined, supplierEntries: [], feedbacks: [], now });
    expect(stepsDeclined.map((s) => [s.label, s.status])).toEqual([
      ['客户发起', 'completed'],
      ['供应商核价', 'skipped'],
      ['报价演进', 'completed'],
      ['客户反馈', 'attention'],
    ]);
    expect(buildCurrentActionAlert({ inquiry: declined, supplierEntries: [], feedbacks: [], now })).toBeNull();

    // Dedupes quote_declined by quote.id across quoteVersions & activeQuote
    const declinedWithVersions = makeInquiry({
      ...declined,
      quoteVersions: [declined.activeQuote!],
    });
    const declinedEvents = buildAdminInquiryTimeline({ inquiry: declinedWithVersions, now });
    expect(declinedEvents.filter((e) => e.type === 'quote_declined')).toHaveLength(1);
  });
});
