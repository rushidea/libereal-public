import { createHash, webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PurchaseManager from '@/components/admin/purchases/PurchaseManager';
import type { Line, Purchase, Workspace } from '@/components/admin/purchases/PurchaseLineForm';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import DocumentDigestField from '@/components/admin/purchases/DocumentDigestField';

const orderId = 'TEST-CUSTOMER-ORDER';
const purchaseId = 'PO-TEST-01';
const orderItemId = 'TEST-ORDER-LINE';
const version = 'b'.repeat(64);
const actionHash = 'c'.repeat(64);
const terms = {
  supplier: '合成供方甲', payee: '合成供方收款账户', paymentTerms: '供方书面确认后按约分付',
  unitPriceCents: 4321, linePayableCents: 8642, currency: 'CNY', taxBasis: 'included',
  freightTerms: '含运费', leadTime: '供方交期五个工作日', validUntil: '2031-06-15T10:20:00Z',
  sourceReference: 'TEST-SUPPLIER-QUOTE', settlementReference: 'TEST-SUPPLIER-SETTLEMENT',
  coordinationReference: 'TEST-CUSTOMER-AND-DELIVERY-CHECK',
} satisfies PurchaseTerms;

type RequestBody = Record<string, unknown>;

const source: Line['source'] = {
  orderItemId, productId: 'test-product', variantId: 'test-package', position: 0,
  brand: '合成品牌', catalogNumber: 'TEST-SKU', name: '合成采购商品', spec: '合成规格',
  unit: '件', quantity: 2, customerLeadTime: '客户要求四周后收货',
  customerConditions: '客户先收货后付款',
  written: {
    reviewId: 'test-supplier-review', replyHash: 'test-written-reply-hash',
    supplier: terms.supplier, unitPriceCents: terms.unitPriceCents, currency: 'CNY', taxBasis: 'included',
    brand: '合成品牌', specification: '合成规格',
    leadTime: terms.leadTime, conditions: '供方书面原条件，采购需要核实付款和收款方',
    validUntil: terms.validUntil, channel: '合成书面回执', reference: terms.sourceReference, confirmedBy: 'test-operator',
  },
};

function makeWorkspace(status?: Purchase['status'], lineChanges: Partial<Line> = {}): Workspace {
  const line: Line = {
    orderItemId, ownerId: 'test-operator', source, terms: status ? terms : {
      unitPriceCents: terms.unitPriceCents, currency: 'CNY', taxBasis: 'included', sourceReference: terms.sourceReference,
      leadTime: terms.leadTime, validUntil: terms.validUntil,
    },
    revision: 3, purchaseOrderId: status ? purchaseId : null, replacementId: null, fromPurchaseOrderId: null, authorizationId:null,
    missing: status ? [] : ['收款方', '供应商付款条件'], availableQuantity: source.quantity,
    ...lineChanges,
  };
  const open = status === 'on_hold' ? {id:'TEST-INCIDENT',reference:'TEST-ORIGINAL-INCIDENT',changeKind:'unavailable',
    previousStatus:'draft',reportedBy:'test-operator',description:'待人工核对原供货条件。',
    responsibility:null,scope:null,outstanding:null,lastReviewedBy:null,factReview:null,reportVersion:version,status:'open' as const,linkedTo:null} : null;
  const purchase: Purchase | null = status ? {
    id: purchaseId, status, version, revision: 4, contentHash: 'd'.repeat(64),
    approvedHash: status === 'draft' || status === 'on_hold' ? null : 'd'.repeat(64),
    totalCents: 8642, paidCents: 0, lines: [line], ledger: [], orderedBefore: status === 'ordered',
    openIncidentId: open?.id ?? null, incident: open, incidents: open ? [open] : [], incidentHistory:open ? [open] : [],
    incidentSources:[{orderItemId,quantity:line.source.quantity,source:{kind:'unshipped'},reference:'TEST-ORDER-REFERENCED'}],
    orderReceipt: null, leadTimeApproved: false,
    dueCents: 8642, remaining: [{ orderItemId, quantity: source.quantity }], remainingScope: null,
    needsRemainingReview: false, payableReviewWindows:[], canApproveRemaining: false, needsLegacyReview: false, needsFundingReapproval: false, canRegisterOrder: status === 'approved',
    documentReviewLines: [], commitmentState: 'ordinary', commitmentExceptions: [], canRecordCommitmentException: false,
  } : null;
  const payment = { receivedCents: 0, allocatedCents: 0, receipts: [], excludedReceiptIds: [], paymentAttemptId: null, nativePaidAt: null, settledReceivableId: null };
  const startReview: Workspace['startReview'] = {
    orderTerms: { orderId, inquiryId: null, organizationId: null, ownerScope: 'personal', customerId: 'test-buyer',
      customerEmail: 'synthetic@example.test', payee: 'Libereal', total: 250, subtotal: 250, pointsDiscount: 0,
      adjustmentTotal: 0, paymentMethod: 'bank_transfer', recipient: null, adjustments: [],
      lines: [{ id: orderItemId, productId: source.productId, variantId: source.variantId, name: source.name, brand: source.brand,
        catalogNumber: source.catalogNumber, spec: source.spec, unit: source.unit, quantity: 2, unitPrice: 125, leadTime: null, conditions: null }] },
    orderCreatedAt: '2031-04-01T00:00:00.000Z', termsVersion: version,
    acceptance: { id: 'test-acceptance', actor: 'test-merchant', at: '2031-04-02T00:00:00.000Z', origin: 'merchant_history' },
    history: [], canVerifyAcceptance: false, active: true, principal: 25000,
    plan: { mode: 'credit', requiredPrepayCents: 0, balanceTerms: null, evidenceId: null },
    payment, bankReceipts: [], outstandingCents: 25000, credit: null, creditVersion: null, overCredit: false, creditExceptionRequired: false, version,
  };
  return {
    orderId, orderStatus: 'confirmed', cancellation: null, canPrepare: false, startReview,
    eligibility: { eligible: true, reason: null, basis: { acceptanceId: 'test-acceptance', receivableId: 'test-receivable',
      reserveId: 'test-credit-reserve', amount: 250, mode: 'credit', payment, planEvidenceId: null } },
    lines: [line], orders: purchase ? [purchase] : [], activities: [], customerRemaining:[{orderItemId,quantity:2}],
    fulfillment: { version, targets: [], delivered: [], historicalDelivered: [], customerReceived: [], supplierReceived: [], warehouseReceived: [], warehouseTransit: [], supplierDispatched: [], incidentSources: [], dispatchHolds: [], shortfalls: [], freeResends: [], parcelLinesWithPriorHoldTransfer: [], replacementsWithPriorHoldTransfer: [], parcelLinesWithUnverifiedStockSource: [], replacementsWithUnverifiedStockSource: [], inconsistent: [], ledger: [] },
  };
}

function preview(body: RequestBody, workspace: Workspace) {
  const [purchase] = workspace.orders;
  const {
    action, reference, description, conditionReference, amountCents, changeKind,
    outcome, supplierReference, customerReference, revisedTerms, occurredAt, referenceSha256,
  } = body;
  return {
    preview: {
      actionHash,
      snapshot: {
        orderId, purchaseOrderId: purchase.id, version: purchase.version, requestId: body.requestId,
        actorId: 'test-admin', totalCents: purchase.totalCents, paidCents: purchase.paidCents,
        lines: purchase.lines.map(({ orderItemId, source, terms, revision }) => ({ orderItemId, source, terms, revision })),
        eligibility: workspace.eligibility,
        operation: { action, reference, description, conditionReference, amountCents, changeKind,
          outcome, supplierReference, customerReference, revisedTerms, occurredAt, referenceSha256,
          ...(action === 'resolve_change' ? {incidentProgress:{
            handled: body.coordinationLines ?? body.affectedLines ?? [{orderItemId,quantity:2}],outstanding:[],
          }} : {}) },
      },
    },
  };
}

function mockWorkspace(workspace: Workspace, permissions: string[], respond?: (body: RequestBody) => Response) {
  const posts: RequestBody[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/admin/purchases?orderId=${orderId}` && !init?.method) return Response.json({ permissions, workspace });
    if (url === '/api/admin/purchases' && init?.method === 'POST') {
      const body: RequestBody = JSON.parse(String(init.body));
      posts.push(body);
      if (respond) return respond(body);
    }
    throw new Error(`Unexpected test request: ${url}`);
  }));
  return posts;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function open(title: string) {
  fireEvent.click(screen.getByText(title, { selector: 'summary' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('supplier purchasing page', () => {
  it('offers the three written shortfall decisions and previews a free resend without changing the payable', async () => {
    const workspace=makeWorkspace('on_hold');
    const [purchase]=workspace.orders;
    purchase.orderedBefore=true;
    purchase.paidCents=900;
    const loss={resolutionId:'TEST-TRACKED-SHORTFALL',purchaseOrderId:purchaseId,orderItemId,route:'supplier_to_customer',
      originalContract:true,quantity:1,available:1,reference:'TEST-ORIGINAL-LOSS-DOCUMENT',occurredAt:'2031-04-15T00:00:00.000Z',independentlyReplaced:0};
    workspace.fulfillment.shortfalls=[{...loss,contractSource:{purchaseOrderId:purchaseId,orderItemId,parcelLineId:'TEST-FIRST-SHIPMENT-LINE',reference:'TEST-FIRST-SUPPLIER-SHIPMENT'}}];
    workspace.fulfillment.supplierDispatched=[{purchaseOrderId:purchaseId,orderItemId,quantity:2}];
    const posts=mockWorkspace(workspace,['purchases.read','purchases.approve'],body=>{
      const result=preview(body,workspace);
      const operation={...result.preview.snapshot.operation,dispositions:[{orderItemId,quantity:1,outcome:'resend',shortfallId:loss.resolutionId,
        shortfallDecision:'free_resend'}],refund:null};
      return Response.json({preview:{...result.preview,snapshot:{...result.preview.snapshot,operation}}});
    });
    render(<PurchaseManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button',{name:'回填协调结果'}));
    fill('协调结果','shortfall');
    fill('已核实的物流短失',loss.resolutionId);
    const decisions=within(screen.getByLabelText('双方书面决定'));
    expect(decisions.getByRole('option',{name:/免费重发/})).toBeInTheDocument();
    expect(decisions.getByRole('option',{name:/变更原合同/})).toBeInTheDocument();
    expect(decisions.getByRole('option',{name:/保留原合同应付.*独立采购/})).toBeInTheDocument();
    fill('双方书面决定','free_resend');
    fill('本次受影响数量','1');
    fill('人工与供应商协调的书面依据','TEST-SUPPLIER-AGREES-TO-RESEND');
    fill('客户对方案的回复依据','TEST-CUSTOMER-AGREEMENT');
    fill('供方书面回复摘要','e'.repeat(64));
    fill('客户书面回复摘要','f'.repeat(64));
    fill('双方确认的具体结果','供方书面承诺免费重发一件。');
    expect(screen.queryByLabelText('原付款与未决退款的后续核对安排')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'查看完整预览'}));
    const panel=await screen.findByRole('region',{name:'操作预览'});
    expect(panel).toHaveTextContent('免费重发，保留原合同');
    expect(posts[0]).toMatchObject({action:'resolve_change',outcome:'shortfall',dispositions:[{
      orderItemId,quantity:1,shortfallId:loss.resolutionId,shortfallDecision:'free_resend',
    }]});
  });

  it('offers only the unused part of an existing free resend and identifies its approval in the preview', async () => {
    const workspace = makeWorkspace('on_hold');
    workspace.orders[0].orderedBefore = true;
    const shortfallId = 'TEST-LOSS-ALREADY-ASSIGNED';
    const approvalId = 'TEST-ORIGINAL-FREE-APPROVAL';
    const authorizedAt = '2031-04-15T00:00:00.000Z';
    const covered = {orderId,purchaseOrderId:purchaseId,orderItemId,shortfallId,quantity:2};
    workspace.fulfillment.shortfalls = [{resolutionId:shortfallId,purchaseOrderId:purchaseId,orderItemId,route:'supplier_to_customer',
      originalContract:true,quantity:2,available:0,reference:'TEST-ORIGINAL-LOST-WAYBILL',occurredAt:authorizedAt,independentlyReplaced:0,
      contractSource:{purchaseOrderId:purchaseId,orderItemId,parcelLineId:'TEST-CONTRACT-PARCEL-LINE',reference:'TEST-FIRST-CONTRACT-SHIPMENT'}}];
    workspace.fulfillment.freeResends = [{approvalId,purchaseOrderId:purchaseId,orderItemId,shortfallId,authorizedAt,kind:'free_resend',
      quantity:2,dispatched:1,redirected:0,available:1,originalHoldAlreadyMoved:true,revisesResendApprovalId:undefined}];
    const posts = mockWorkspace(workspace,['purchases.read','purchases.approve'],body=>{
      const result = preview(body,workspace);
      const operation = {...result.preview.snapshot.operation,dispositions:[{orderItemId,quantity:1,outcome:'cancel',shortfallId,
        shortfallDecision:'change_contract',revisesResendApprovalId:approvalId,supplierDocumentRow:2,customerDocumentRow:12,contractSource:workspace.fulfillment.shortfalls[0].contractSource,
        priorResend:{authorized:2,dispatched:1,redirected:0,available:1}}],
        decisionDocuments:[{role:'supplier',sha256:'e'.repeat(64),row:2,balances:[{...covered,usedBefore:1,using:1,remaining:0}]}],
      };
      return body.stage === 'confirm' ? Response.json({workspace})
        : Response.json({preview:{...result.preview,snapshot:{...result.preview.snapshot,operation}}});
    });
    render(<PurchaseManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button',{name:'回填协调结果'}));
    fill('协调结果','shortfall');
    expect(screen.getByRole('option',{name:/免费补发已发 1.*可改办 1/})).toBeInTheDocument();
    fill('已核实的物流短失',approvalId);
    expect(screen.queryByRole('option',{name:/供方同意免费重发/})).not.toBeInTheDocument();
    expect(screen.getByLabelText('本次受影响数量')).toHaveAttribute('max','1');
    fill('双方书面决定','change_contract');
    fill('供方决定原件行号','2');
    fill('客户同意原件行号','12');
    expect(screen.getByText(/对应原合同发货凭据 TEST-FIRST-CONTRACT-SHIPMENT/)).toBeInTheDocument();
    fill('本次受影响数量','1');
    fireEvent.click(screen.getByText('核对供方书证覆盖范围'));
    fireEvent.click(screen.getByRole('button',{name:'填写供方书证覆盖的采购行及总量'}));
    fill('供方书证核准总量','2');
    fill('人工与供应商协调的书面依据','TEST-NEW-SUPPLIER-DECISION');
    fill('客户对方案的回复依据','TEST-NEW-CUSTOMER-CONSENT');
    fill('供方书面回复摘要','e'.repeat(64));
    fill('客户书面回复摘要','f'.repeat(64));
    fill('双方确认的具体结果','双方同意变更未发的一件。');
    fireEvent.click(screen.getByRole('button',{name:'查看完整预览'}));
    const panel = await screen.findByRole('region',{name:'操作预览'});
    expect(panel).toHaveTextContent(/原免费批准.*核准 2.*本次改办 1/);
    expect(panel).toHaveTextContent('供方决定原件第 2 行');
    expect(panel).toHaveTextContent('客户同意原件第 12 行');
    expect(panel).toHaveTextContent('对应原合同发货凭据 TEST-FIRST-CONTRACT-SHIPMENT');
    expect(panel).toHaveTextContent('核准 2 · 已用 1 · 本次 1 · 办理后剩余 0');
    expect(posts[0]).toMatchObject({stage:'preview',dispositions:[{orderItemId,shortfallId,
      revisesResendApprovalId:approvalId,quantity:1,shortfallDecision:'change_contract',supplierDocumentRow:2,customerDocumentRow:12,
      supplierDocumentScope:[covered]}]});
    fireEvent.click(within(panel).getByRole('button',{name:/确认/}));
    await waitFor(()=>expect(posts[1]).toMatchObject({stage:'confirm',version,actionHash,
      requestId:posts[0].requestId,dispositions:posts[0].dispositions}));
  });

  it('uses numbered document scopes when the purchase page records agreement to continue an original contract', async () => {
    const workspace = makeWorkspace('on_hold');
    workspace.orders[0].orderedBefore = true;
    const posts = mockWorkspace(workspace,['purchases.read','purchases.approve'],body=>Response.json(preview(body,workspace)));
    render(<PurchaseManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button',{name:'回填协调结果'}));
    expect(screen.getByLabelText('协调结果')).toHaveValue('original_terms');
    fireEvent.change(screen.getByLabelText(/原供货事项完整涉及范围 · 合成采购商品/),{target:{value:'2'}});
    fill('人工与供应商协调的书面依据','TEST-SUPPLIER-CONTINUATION-FILE');
    fill('客户对方案的回复依据','TEST-CUSTOMER-CONTINUATION-FILE');
    fill('供方书面回复摘要','d'.repeat(64));
    fill('客户书面回复摘要','e'.repeat(64));
    fill('双方确认的具体结果','续办原采购合同的两件商品。');
    fill('供方决定原件行号','8');
    fill('客户同意原件行号','12');
    fireEvent.click(screen.getByRole('button',{name:'查看完整预览'}));
    await screen.findByRole('region',{name:'操作预览'});
    expect(posts[0]).toMatchObject({outcome:'original_terms',decisionDocumentLines:[{
      orderItemId,supplierDocumentRow:8,customerDocumentRow:12,
    }]});
  });

  it('shows the remaining payable and waits for the quantity outside the current coordination result', async () => {
    const workspace = makeWorkspace('on_hold');
    const [purchase] = workspace.orders;
    const scope = [{orderItemId,quantity:2}];
    const portion = [{orderItemId,quantity:1}];
    Object.assign(purchase,{
      orderedBefore:true,paidCents:900,dueCents:null,needsRemainingReview:true,
      incidents:[{...purchase.incidents[0],reference:'TEST-TWO-DELAYED',changeKind:'delay',scope,outstanding:scope}],
    });
    const posts = mockWorkspace(workspace,['purchases.read','purchases.approve'],body=>{
      const {preview:result} = preview(body,workspace);
      return Response.json({preview:{...result,snapshot:{...result.snapshot,operation:{...result.snapshot.operation,
        incidentProgress:{scope,handled:portion,outstanding:portion,scopeBasis:'recorded'},
      }}}});
    });
    render(<PurchaseManager initialOrder={orderId}/>);
    expect(await screen.findByText('原单剩余应付待独立核准。供货协调结果可据实登记。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'回填协调结果'}));
    expect(screen.queryByText('原供货事项完整涉及范围')).not.toBeInTheDocument();
    fill('人工与供应商协调的书面依据','TEST-SIGNED-SUPPLIER-ONE');
    fill('客户对方案的回复依据','TEST-SIGNED-CUSTOMER-ONE');
    fill('供方书面回复摘要','d'.repeat(64));
    fill('客户书面回复摘要','e'.repeat(64));
    fill('双方确认的具体结果','同意一件按原约交付，另一件继续由采购经办人核对。');
    fireEvent.change(screen.getByLabelText(/本次继续原约的数量 · 合成采购商品/),{target:{value:'1'}});
    fill('供方决定原件行号','8');
    fill('客户同意原件行号','12');
    fireEvent.click(screen.getByRole('button',{name:'查看完整预览'}));
    const panel = await screen.findByRole('region',{name:'操作预览'});
    expect(panel).toHaveTextContent('本次处理 合成采购商品 1');
    expect(panel).toHaveTextContent('仍待办理 合成采购商品 1');
    expect(posts[0]).toMatchObject({outcome:'original_terms',coordinationLines:portion,
      decisionDocumentLines:[{orderItemId,supplierDocumentRow:8,customerDocumentRow:12}]});
    expect(posts[0]).not.toHaveProperty('affectedLines');
  });

  it('opens the requested separate supply item and submits a fact review without a commercial outcome',async()=>{
    const workspace = makeWorkspace('on_hold');
    const [purchase] = workspace.orders;
    purchase.orderedBefore = true;
    const first = purchase.incidents[0];
    purchase.incidents = [{...first,id:'INCIDENT-A',reference:'TEST-A',description:'A 原事项仍待答复。'},
      {...first,id:'INCIDENT-B',reference:'TEST-B',description:'B 的旧邮件只需核实范围。'}];
    const posts = mockWorkspace(workspace,['purchases.read','purchases.approve','purchases.write'],body=>{
      const {preview:result} = preview(body,workspace);
      return Response.json({preview:{...result,snapshot:{...result.snapshot,operation:{...result.snapshot.operation,
        outstanding:body.affectedLines,
      }}}});
    });
    render(<PurchaseManager initialOrder={orderId}/>);
    const target = await screen.findByRole('region',{name:'供货事项 TEST-B'});
    expect(screen.getByRole('button',{name:'登记供货变化'})).toBeInTheDocument();
    fireEvent.click(within(target).getByRole('button',{name:'核对供货事项范围'}));
    expect(screen.getByText('核对供货事项范围 · TEST-B')).toBeInTheDocument();
    expect(screen.queryByLabelText('协调结果')).not.toBeInTheDocument();
    fill('核对范围的原凭据出处','TEST-ORIGINAL-B-EMAIL');
    fill('实际受影响的货物与仍待协调的情况','只核到一件待发货受影响。');
    fireEvent.change(screen.getByLabelText(/核实后仍受影响的货物和数量 · 合成采购商品.*供方尚未发出的原货/),{target:{value:'1'}});
    fireEvent.click(screen.getByRole('button',{name:'查看完整预览'}));
    const panel = await screen.findByRole('region',{name:'操作预览'});
    expect(panel).toHaveTextContent('仍待协调 1');
    expect(posts[0]).toMatchObject({action:'review_change_scope',incidentId:'INCIDENT-B',
      affectedLines:[{orderItemId,quantity:1,source:{kind:'unshipped'}}],reference:'TEST-ORIGINAL-B-EMAIL'});
    expect(posts[0]).not.toHaveProperty('outcome');
    expect(screen.getByRole('region',{name:'供货事项 TEST-A'})).toBeInTheDocument();
  });

  it('submits an independently written retained quote for one of two draft units',async()=>{
    const workspace=makeWorkspace('on_hold',{replacementId:'TEST-ALT-ROW',fromPurchaseOrderId:'TEST-PARENT-PO',authorizationId:'TEST-PARENT-AUTH'});
    const [purchase] = workspace.orders;
    const onlyOne=[{orderItemId,quantity:1,source:{kind:'unshipped' as const}}];
    purchase.incidents=[{...purchase.incidents[0],scope:onlyOne,outstanding:onlyOne}];
    const posts=mockWorkspace(workspace,['purchases.read','purchases.write'],body=>{
      const {preview:result}=preview(body,workspace);
      return Response.json({preview:{...result,snapshot:{...result.snapshot,operation:{...result.snapshot.operation,
        incidentProgress:{handled:onlyOne,outstanding:[]},draftAllocations:[{orderItemId,quantity:1,originalQuantity:2,originalQuotedCents:8642,
          retained:{source:{...source,quantity:1},terms:{...terms,linePayableCents:4550}}}],
      }}}});
    });
    render(<PurchaseManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button',{name:'回填协调结果'}));
    fill('协调结果','declined');
    const quote=within(screen.getByRole('group',{name:/留存 1.*书面新报价/}));
    const amount=quote.getByLabelText('含税含费用的本行应付合计（元）');
    expect(amount).toHaveValue('');
    fireEvent.change(amount,{target:{value:'45.50'}});
    fireEvent.change(quote.getByLabelText('供应商书面报价依据'),{target:{value:'TEST-KEPT-ONE-ACTUAL-QUOTE'}});
    fireEvent.change(quote.getByLabelText('供货书证摘要'),{target:{value:'a'.repeat(64)}});
    fireEvent.change(quote.getByLabelText('客户同意原件行号'),{target:{value:'9'}});
    fireEvent.click(quote.getByLabelText('留存份额另有客户书证'));
    fireEvent.change(quote.getByLabelText('客户同意留存份额的书证出处'),{target:{value:'TEST-RETAINED-FILE-SPECIFIC'}});
    fireEvent.change(quote.getByLabelText('客户同意留存份额的书证摘要'),{target:{value:'b'.repeat(64)}});
    fill('人工与供应商协调的书面依据','TEST-SUPPLIER-REPLY');
    fill('客户对方案的回复依据','TEST-ACTUAL-BUYER-CHOICE');
    fill('客户书面撤回依据摘要','e'.repeat(64));
    fill('双方确认的具体结果','只撤一件，另一件按新报价继续准备。');
    fireEvent.click(screen.getByRole('button',{name:'查看完整预览'}));
    const panel=await screen.findByRole('region',{name:'操作预览'});
    expect(panel).toHaveTextContent('原组留存 1 件 · 新报价');
    expect(posts[0]).toMatchObject({outcome:'declined',retainedDraftTerms:[{orderItemId,customerDocumentRow:9,
      customerDecision:{reference:'TEST-RETAINED-FILE-SPECIFIC',sha256:'b'.repeat(64)},
      terms:{sourceReference:'TEST-KEPT-ONE-ACTUAL-QUOTE',sourceSha256:'a'.repeat(64),linePayableCents:4550}}]});
  });

  it('offers customer document row and coverage on the existing replacement revision form', async () => {
    const workspace = makeWorkspace('on_hold',{fromPurchaseOrderId:'TEST-OLD-ORIGINAL-PURCHASE'});
    mockWorkspace(workspace,['purchases.read','purchases.write']);
    render(<PurchaseManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button',{name:'回填协调结果'}));
    fill('协调结果','revised_terms');
    expect(screen.getByLabelText('替代条件变更后客户同意的书证摘要')).toBeInTheDocument();
    fill('客户同意原件行号','6');
    fireEvent.click(screen.getByText('核对客户书证覆盖范围'));
    fireEvent.click(screen.getByRole('button',{name:'填写客户书证覆盖的采购行及总量'}));
    expect(screen.getByLabelText('客户书证核准总量')).toHaveAttribute('max','2');
  });

  it('adds only the two evidenced shortfalls across purchase lines to the document scope', async () => {
    const workspace = makeWorkspace('on_hold');
    const [first] = workspace.orders;
    first.orderedBefore = true;
    const otherPurchase = 'PO-OTHER-COVERED';
    const otherLine = 'TEST-OTHER-CUSTOMER-LINE';
    workspace.orders.push({...first,id:otherPurchase,version:'6'.repeat(64),status:'ordered',openIncidentId:null,incident:null,incidents:[],
      lines:[{...first.lines[0],orderItemId:otherLine,purchaseOrderId:otherPurchase,
        source:{...first.lines[0].source,orderItemId:otherLine,name:'另一采购商品'}}]});
    workspace.fulfillment.shortfalls = ['A','B','C'].map(name=>({
      resolutionId:'EXACT-LOSS-'+name,purchaseOrderId:name==='B'?otherPurchase:purchaseId,
      orderItemId:name==='B'?otherLine:orderItemId,route:'supplier_to_customer',originalContract:true,contractSource:null,
      quantity:1,available:1,reference:'TEST-TRUE-LOSS-'+name,occurredAt:'2031-04-15T00:00:00.000Z',independentlyReplaced:0,
    }));
    const posts = mockWorkspace(workspace,['purchases.read','purchases.approve'],body=>Response.json(preview(body,workspace)));
    render(<PurchaseManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button',{name:'回填协调结果'}));
    fill('协调结果','shortfall');
    fill('已核实的物流短失','EXACT-LOSS-A');
    fill('双方书面决定','free_resend');
    fill('本次受影响数量','1');
    fill('客户同意原件行号','8');
    fireEvent.click(screen.getByText('核对客户书证覆盖范围'));
    fireEvent.click(screen.getByRole('button',{name:'填写客户书证覆盖的采购行及总量'}));
    const options = screen.getByLabelText('添加原件列明的物流短失');
    const b = within(options).getByRole<HTMLOptionElement>('option',{name:/TEST-TRUE-LOSS-B/});
    fireEvent.change(options,{target:{value:b.value}});
    expect(screen.getByRole('group',{name:/TEST-TRUE-LOSS-A/})).toBeInTheDocument();
    expect(screen.getByRole('group',{name:/TEST-TRUE-LOSS-B/})).toBeInTheDocument();
    expect(screen.queryByRole('group',{name:/TEST-TRUE-LOSS-C/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'按编号添加其他订单的采购行'}));
    expect(screen.getByLabelText('已核实的物流短失编号')).toBeRequired();
    fireEvent.click(screen.getAllByRole('button',{name:'移除此范围'}).at(-1)!);
    fill('人工与供应商协调的书面依据','TEST-EXACT-SUPPLIER-ORIGINAL');
    fill('客户对方案的回复依据','TEST-CLIENT-ONLY-A-AND-B');
    fill('供方书面回复摘要','d'.repeat(64));
    fill('客户书面回复摘要','e'.repeat(64));
    fill('双方确认的具体结果','只同意按实际 A 与 B 两项免费补件。');
    fireEvent.click(screen.getByRole('button',{name:'查看完整预览'}));
    await screen.findByRole('region',{name:'操作预览'});
    expect(posts[0]).toMatchObject({dispositions:[{customerDocumentScope:[
      {orderId,purchaseOrderId:purchaseId,orderItemId,shortfallId:'EXACT-LOSS-A',quantity:1},
      {orderId,purchaseOrderId:otherPurchase,orderItemId:otherLine,shortfallId:'EXACT-LOSS-B',quantity:1},
    ]}]});
  });

  it('finds the customer order, preserves missing terms, and keeps customer conditions out of supplier fields', async () => {
    const workspace = makeWorkspace();
    const requests: RequestBody[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const permissions = ['purchases.read', 'purchases.write'];
      if (url.pathname !== '/api/admin/purchases') throw new Error(`Unexpected test request: ${url}`);
      if (init?.method === 'POST') {
        const body: RequestBody = JSON.parse(String(init.body));
        requests.push(body);
        return Response.json({ workspace: makeWorkspace(undefined, {
          revision: 4, terms: { ...workspace.lines[0].terms, payee: terms.payee }, missing: ['供应商付款条件'],
        }) });
      }
      if (url.searchParams.get('orderId') === orderId) return Response.json({ permissions, workspace });
      return Response.json({ permissions, orders: url.searchParams.get('search') === orderId
        ? [{ id: orderId, status: 'confirmed', prepared: 1, purchases: 0 }] : [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PurchaseManager initialOrder="" />);

    expect(await screen.findByText('未找到可以查看的采购记录。')).toBeInTheDocument();
    fill('客户订单号或采购单号', orderId);
    fireEvent.click(screen.getByRole('button', { name: '查找' }));
    fireEvent.click(await screen.findByRole('button', { name: orderId }));

    expect(await screen.findByRole('heading', { name: `客户订单 ${orderId}` })).toBeInTheDocument();
    expect(screen.getByText('待补 收款方、供应商付款条件')).toBeInTheDocument();
    expect(screen.getByText(/原供应商回复.*合成供方甲.*43\.21/)).toBeInTheDocument();
    expect(screen.getByText(source.written!.conditions)).toBeInTheDocument();
    open('编辑本行采购资料');
    expect(screen.getByLabelText('供应商付款条件')).toHaveValue('');
    expect(screen.getByLabelText('供货期')).toHaveValue(terms.leadTime);
    expect(screen.getByLabelText('收款方全称')).toHaveValue('');
    expect(screen.queryByText('客户先收货后付款')).not.toBeInTheDocument();
    expect(screen.queryByText('客户要求四周后收货')).not.toBeInTheDocument();
    expect(requests).toEqual([]);

    fill('收款方全称', terms.payee);
    fireEvent.click(screen.getByRole('button', { name: '保存本行资料' }));
    expect(await screen.findByText('待补 供应商付款条件')).toBeInTheDocument();
    expect(requests).toEqual([{
      action: 'save_line', orderId, orderItemId, revision: 3, checkedEvidence: false,
      terms: { ...workspace.lines[0].terms, payee: terms.payee },
    }]);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      `/api/admin/purchases?search=${orderId}`, `/api/admin/purchases?orderId=${orderId}`,
    ]));
  });

  it.each(['confirmed', 'partially_shipped'])('prepares the eligible outstanding lines from the normal page (%s)', async orderStatus => {
    const workspace = { ...makeWorkspace(), orderStatus, canPrepare: true, lines: orderStatus === 'confirmed' ? [] : makeWorkspace().lines };
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.write'], () =>
      Response.json({ workspace: makeWorkspace() }),
    );
    render(<PurchaseManager initialOrder={orderId} />);

    const prepare = await screen.findByRole('button', { name: '从原订单准备采购' });
    expect(posts).toEqual([]);
    fireEvent.click(prepare);

    expect(await screen.findByText('待补 收款方、供应商付款条件')).toBeInTheDocument();
    await waitFor(() => expect(posts).toEqual([{ action: 'prepare', orderId }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: '从原订单准备采购' })).not.toBeInTheDocument());
  });

  it.each(['on_hold', 'ordered'] as const)('keeps the original contract and deposit visible during review of a %s purchase', async status => {
    const workspace = makeWorkspace(status);
    const [purchase] = workspace.orders;
    Object.assign(purchase, { openIncidentId: null, incident:null, incidents:[], dueCents: null, paidCents: 2300, needsRemainingReview: true, canApproveRemaining: true,
      remaining: [{ orderItemId, quantity: 1 }] });
    const scope = { lines: [{ orderItemId, quantity: 1, payableCents: 4000 }], totalCents: 4000, appliedPaidCents: 1000, dispositionIds: ['TEST-CANCEL'],
      payments: [{ id: 'TEST-DEPOSIT', amountCents: 2300 }] };
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.approve', 'purchases.pay'], body => {
      if (body.stage === 'preview') {
        const result = preview(body, workspace);
        return Response.json({ preview: { ...result.preview, snapshot: { ...result.preview.snapshot, operation: { ...result.preview.snapshot.operation, scope } } } });
      }
      return Response.json({ workspace: { ...workspace, orders: [{ ...purchase, status: status === 'ordered' ? 'ordered' : 'approved', revision: 5, version: 'e'.repeat(64),
        dueCents: 3000, needsRemainingReview: false, payableReviewWindows:[], canApproveRemaining: false, remainingScope: scope }] } });
    });
    render(<PurchaseManager initialOrder={orderId} />);
    expect(await screen.findByText(/原合同应付/)).toHaveTextContent(/86\.42.*已登记实际付款.*23\.00/);
    expect(screen.queryByRole('button', { name: '登记实际付款' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '核准原单剩余应付' }));
    fill('本行核实应付（元）', '40');
    fill('已付款中确认抵扣剩余应付的金额（元，可填 0）', '10');
    fill('供方确认剩余行金额及付款归属的书面依据', 'TEST-SIGNED-STATEMENT');
    fill('剩余应付确认书证摘要', 'd'.repeat(64));
    fill('逐行应付和原付款归属核对结果', '已核对合成剩余款。');
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const panel = await screen.findByRole('region', { name: '操作预览' });
    expect(panel).toHaveTextContent(/剩余商品应付.*40\.00.*已付款确认抵扣.*10\.00.*本次核实未付.*30\.00/);
    expect(posts[0]).toMatchObject({ action: 'approve_remaining', appliedPaidCents: 1000, remainingLines: [{ orderItemId, payableCents: 4000 }] });
    fireEvent.click(within(panel).getByRole('button', { name: '确认核准原单剩余应付' }));
    expect(await screen.findByText(/核准的剩余商品应付.*40\.00.*尚未付.*30\.00/)).toBeInTheDocument();
    expect(screen.getByText(/原合同应付/)).toHaveTextContent(/86\.42.*已登记实际付款.*23\.00/);
    expect(screen.getByRole('button', { name: '登记实际付款' })).toBeInTheDocument();
    expect(posts[1]).toMatchObject({ stage: 'confirm', actionHash, requestId: posts[0].requestId });
  });

  it('reviews an actual supplier cancellation without opening the original purchase for payment or registration', async () => {
    const workspace = makeWorkspace('on_hold');
    const [purchase] = workspace.orders;
    const original = { id: 'TEST-EXCEPTION', actorId: 'test-owner', reference: 'TEST-CREDIT-COMMITMENT', occurredAt: '2031-06-01T09:00:00.000Z',
      outcome: 'liability_review', resolution: null, resolutionId: null, resolutionActorId: null };
    Object.assign(purchase, { openIncidentId: null, incident:null, incidents:[], dueCents: null, paidCents: 900, needsRemainingReview: true,
      remaining: [{ orderItemId, quantity: 1 }], commitmentState: 'pending', commitmentExceptions: [original] });
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.approve', 'purchases.pay', 'purchases.write'], body => {
      const result = preview(body, workspace);
      const operation = { ...result.preview.snapshot.operation, resolution: body.exceptionResolution, responsibleActor: 'test-reviewer',
        remainingReviewPending: false, refund: { status: 'pending_review', paidCents: 900, responsibleActor: 'test-reviewer', followup: body.description } };
      if (body.stage === 'preview') return Response.json({ preview: { ...result.preview, snapshot: { ...result.preview.snapshot, operation } } });
      const cancelled = { ...purchase, needsRemainingReview: false, commitmentState: 'supplier_cancelled', commitmentExceptions: [{
        ...original, resolution: 'supplier_cancelled', resolutionId: 'TEST-CANCELLATION', resolutionActorId: 'test-reviewer',
      }], ledger: [{ id: 'TEST-CANCELLATION', action: 'resolve_order_exception', createdAt: original.occurredAt,
        actorId: 'test-reviewer', detail: { snapshot: { operation } } }] };
      return Response.json({ workspace: { ...workspace, orders: [cancelled] } });
    });
    render(<PurchaseManager initialOrder={orderId} />);
    expect(await screen.findByText('核对实际承诺后，再逐行核准原单剩余应付。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '核准原单剩余应付' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登记实际付款' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '核对订购异常处理结果' }));
    fill('核对结果', 'supplier_cancelled');
    fill('供方书面处理结果及原合同应付核对依据', 'TEST-SUPPLIER-CANCELLATION');
    fill('异常处理结果书证摘要', 'e'.repeat(64));
    fill('核对结果及已付款、退款或取消费用的后续安排', '按供方原件核对定金和退款。');
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const panel = await screen.findByRole('region', { name: '操作预览' });
    expect(panel).toHaveTextContent(/供方整笔取消.*责任人 test-reviewer/);
    expect(panel).toHaveTextContent(/原单已付.*9\.00.*退款待财务核对/);
    fireEvent.click(within(panel).getByRole('button', { name: '确认核对订购异常处理结果' }));
    expect(await screen.findByText('供方整笔取消')).toBeInTheDocument();
    expect(screen.getByText('原付款的退款安排待财务核对。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登记供货变化' })).toBeInTheDocument();
    for (const name of ['核准原单剩余应付', '登记实际付款', '登记供应商订购结果', '补录暂停前实际订购']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(posts[1]).toMatchObject({ stage: 'confirm', actionHash, requestId: posts[0].requestId, exceptionResolution: 'supplier_cancelled' });
  });

  it('requires legacy proof on the same paid purchase before it can be registered', async () => {
    const workspace = makeWorkspace('approved');
    const [purchase] = workspace.orders;
    Object.assign(purchase, { paidCents: 900, dueCents: 7742, needsLegacyReview: true, canRegisterOrder: false });
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.approve', 'purchases.write', 'purchases.pay'], body => {
      if (body.stage === 'preview') {
        const result = preview(body, workspace);
        const operation = { ...result.preview.snapshot.operation, paymentReference: body.paymentReference, checkedTerms: body.revisedTerms,
          evidence: { approval: { actorId: 'test-original-approver', recordedAt: '2031-04-05T00:00:00Z' },
            payments: [{ id: 'test-deposit', amountCents: 900, receiptReference: 'TEST-ORIGINAL-TRANSFER' }] } };
        return Response.json({ preview: { ...result.preview, snapshot: { ...result.preview.snapshot, operation } } });
      }
      return Response.json({ workspace: { ...workspace, orders: [{ ...purchase, version: 'd'.repeat(64), needsLegacyReview: false, canRegisterOrder: true }] } });
    });
    render(<PurchaseManager initialOrder={orderId} />);
    fireEvent.click(await screen.findByRole('button', { name: '复核旧采购批准' }));
    expect(screen.queryByRole('button', { name: '登记供应商订购结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登记实际付款' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('采购单价（元）')).not.toBeInTheDocument();
    fill('原采购授权的档案出处', 'TEST-ORIGINAL-PURCHASE-APPROVAL');
    fill('原采购授权书证摘要', 'b'.repeat(64));
    fill('已付款凭证的档案出处', 'TEST-ORIGINAL-TRANSFER');
    fill('已付款凭证摘要', 'c'.repeat(64));
    fill('核对原授权、付款及本次接续结果', '已核对原授权和原定金。');
    fill('供货书证摘要', 'd'.repeat(64));
    fill('结算书证摘要', 'e'.repeat(64));
    fill('本单交期核对结果', 'within_agreement');
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const panel = await screen.findByRole('region', { name: '操作预览' });
    expect(panel).toHaveTextContent(/原批准人 test-original-approver/);
    expect(panel).toHaveTextContent(/原付款.*9\.00.*TEST-ORIGINAL-TRANSFER/);
    expect(posts[0]).toMatchObject({ action: 'review_legacy_approval', purchaseOrderId: purchaseId,
      revisedTerms: [{ orderItemId, terms: { linePayableCents: 8642, sourceSha256: 'd'.repeat(64), settlementSha256: 'e'.repeat(64) } }] });
    fireEvent.click(within(panel).getByRole('button', { name: '确认复核旧采购批准' }));
    expect(await screen.findByRole('button', { name: '登记供应商订购结果' })).toBeInTheDocument();
    expect(posts.map(body => body.action)).toEqual(['review_legacy_approval', 'review_legacy_approval']);
  });

  it('exposes a pre-hold receipt action and preserves the visible supply hold after confirmation', async () => {
    const workspace = makeWorkspace('on_hold');
    const [purchase] = workspace.orders;
    purchase.canRegisterOrder = true;
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.write'], body => {
      if (body.stage === 'preview') return Response.json(preview(body, workspace));
      return Response.json({ workspace: { ...workspace, orders: [{ ...purchase, version: 'd'.repeat(64), canRegisterOrder: false, orderedBefore: true,
        orderReceipt: { occurredAt: body.occurredAt, registeredAt: '2031-04-13T09:00:00.000Z', reference: body.reference, lines: [] } }] } });
    });
    render(<PurchaseManager initialOrder={orderId} />);
    fireEvent.click(await screen.findByRole('button', { name: '补录暂停前实际订购' }));
    expect(screen.getByText(/采购仍处于暂停/)).toBeInTheDocument();
    fill('供应商已接受订购的单据或书面确认编号', 'TEST-BEFORE-HOLD');
    fill('供应商实际确认订购时间（本地时间）', '2031-04-13T08:00');
    fill('实际订购凭据摘要', 'e'.repeat(64));
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const panel = await screen.findByRole('region', { name: '操作预览' });
    expect(panel).toHaveTextContent('TEST-BEFORE-HOLD');
    fireEvent.click(within(panel).getByRole('button', { name: '确认登记供应商订购结果' }));
    expect(await screen.findByText(/供应商实际订购.*TEST-BEFORE-HOLD/)).toBeInTheDocument();
    expect(screen.getByText('供货变化待处理')).toBeInTheDocument();
    expect(posts[1]).toMatchObject({ action: 'register_order', stage: 'confirm', requestId: posts[0].requestId, actionHash });
  });

  it.each([{ rows: [1, 2] }, { rows: [3] }])('reviews original quote rows $rows without editing archived prices', async ({ rows }) => {
    const workspace = makeWorkspace('approved');
    const [purchase] = workspace.orders;
    const sha256 = 'd'.repeat(64);
    const secondId = 'TEST-LEGACY-QUOTE-B';
    purchase.lines = [{ ...purchase.lines[0], terms: { ...terms, sourceSha256: sha256 } },
      { ...purchase.lines[0], orderItemId: secondId, source: { ...source, orderItemId: secondId, name: '第二种合成商品', catalogNumber: 'TEST-QUOTE-B', quantity: 1 },
        terms: { ...terms, sourceSha256: sha256, unitPriceCents: 2500, linePayableCents: 2500 } }].slice(0, rows.length);
    purchase.paidCents = 900;
    purchase.needsFundingReapproval = true;
    purchase.documentReviewLines = purchase.lines.map(line => ({ orderItemId: line.orderItemId, sha256, reference: terms.sourceReference }));
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.approve'], body => {
      if (body.stage === 'preview') {
        const result = preview(body, workspace);
        const documents = purchase.lines.map((line, index) => ({ ...line, terms: { ...line.terms, sourceDocumentKind: 'multiple_items', sourceDocumentRow: rows[index] } }));
        const operation = { ...result.preview.snapshot.operation, originalApprovalId: 'TEST-PRIOR-APPROVAL', fundingPlan: workspace.startReview.plan,
          payments: [{ id: 'TEST-PAID-DEPOSIT', amountCents: 900, reference: 'TEST-ORIGINAL-DEPOSIT' }], documentScopes: documents };
        return Response.json({ preview: { ...result.preview, snapshot: { ...result.preview.snapshot, operation } } });
      }
      return Response.json({ workspace: { ...workspace, orders: [{ ...purchase, version: 'a'.repeat(64), needsFundingReapproval: false, documentReviewLines: [] }] } });
    });
    render(<PurchaseManager initialOrder={orderId} />);
    fireEvent.click(await screen.findByRole('button', { name: '重新核准本单后续动作' }));
    expect(screen.getByText(/本单只采用一项/)).toBeInTheDocument();
    if (rows.length > 1) expect(screen.getByText(/第二种合成商品.*TEST-QUOTE-B.*数量 1.*25\.00/)).toBeInTheDocument();
    expect(screen.queryByLabelText('采购单价（元）')).not.toBeInTheDocument();
    fill('旧供货原件摘要', sha256);
    fill('原供货文件范围', 'multiple_items');
    purchase.lines.forEach((line, index) => fill(`${line.source.catalogNumber} 对应原件行序号`, String(rows[index])));
    fill('客户付款条件变动的档案出处', 'TEST-CHANGED-AGREEMENT');
    fill('新批准依据摘要', 'c'.repeat(64));
    fill('本次重新批准的后续动作与旧款归属', '按对应原报价行和定金核对新条件。');
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const panel = await screen.findByRole('region', { name: '操作预览' });
    rows.forEach(row => expect(panel).toHaveTextContent(`原件第 ${row} 行`));
    expect(panel).toHaveTextContent(/已付.*9\.00.*TEST-ORIGINAL-DEPOSIT/);
    expect(posts[0]).toMatchObject({ action: 'reapprove_purchase', documentScopes: purchase.lines.map((line, index) => ({
      orderItemId: line.orderItemId, sha256, kind: 'multiple_items', row: rows[index],
    })) });
    fireEvent.click(within(panel).getByRole('button', { name: '确认重新核准本单后续动作' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '操作预览' })).not.toBeInTheDocument());
    expect(posts[1]).toMatchObject({ stage: 'confirm', actionHash, requestId: posts[0].requestId, documentScopes: posts[0].documentScopes });
  });

  it('previews the exact sources of a single customer shipment and confirms the same attribution once', async () => {
    const workspace = makeWorkspace('ordered');
    const target = { id: 'TEST-SHIPMENT-LINE', shipmentId: 'TEST-SHIPMENT', orderItemId, name: '合成采购商品', quantity: 2,
      occurredAt: '2031-05-01T08:00:00.000Z', reference: 'TEST-CARRIER', purchaseSources: [{ purchaseOrderId: purchaseId, quantity: 2, orderedAt: null }] };
    workspace.fulfillment.targets = [target];
    const operation = { target, sources: [{ purchaseOrderId: purchaseId, quantity: 1 }, { purchaseOrderId: null, quantity: 1 }],
      occurredAt: target.occurredAt, reference: 'TEST-SHIPMENT-ARCHIVE', sha256: 'e'.repeat(64), description: '核对出库来源与合计。' };
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.approve'], body => {
      if (body.stage === 'preview') return Response.json({ preview: { actionHash, snapshot: { orderId, operation, referenceKey: 'TEST-SHIPMENT-REFERENCE' } } });
      return Response.json({ workspace: { ...workspace, fulfillment: { ...workspace.fulfillment, version: 'd'.repeat(64), targets: [],
        ledger: [{ id: 'TEST-ATTRIBUTION', actorId: 'test-approver', recordedAt: target.occurredAt, operation }] } } });
    });
    render(<PurchaseManager initialOrder={orderId} />);
    fireEvent.click(await screen.findByRole('button', { name: '核对发货来源' }));
    fill(`采购单 ${purchaseId} 的发出数量`, '1');
    fill('其他有据来源的发出数量', '1');
    fill('发货来源书面凭据档案', operation.reference);
    fill('发货来源书证摘要', operation.sha256);
    fill('发货归属核对结果', operation.description);
    fireEvent.click(screen.getByRole('button', { name: '查看发货归属预览' }));
    const previewPanel = await screen.findByRole('region', { name: '发货归属预览' });
    expect(previewPanel).toHaveTextContent(`采购单 ${purchaseId} · 1`);
    expect(previewPanel).toHaveTextContent('其他有据来源 · 1');
    expect(posts[0]).toMatchObject({ action: 'attribute_purchase_shipment', targetId: target.id, sources: operation.sources });
    fireEvent.click(within(previewPanel).getByRole('button', { name: '确认发货归属' }));
    expect(await screen.findByText('查看已核对的发货归属')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '核对发货来源' })).not.toBeInTheDocument();
    expect(posts[1]).toMatchObject({ stage: 'confirm', actionHash, requestId: posts[0].requestId });
  });

  it.each(['draft', 'approved', 'on_hold'] as const)('shows records without mutation controls to a read-only role (%s)', async status => {
    const posts = mockWorkspace(makeWorkspace(status), ['purchases.read']);
    render(<PurchaseManager initialOrder={orderId} />);

    expect(await screen.findByRole('heading', { name: '采购单' })).toBeInTheDocument();
    expect(screen.getByText(/PO-TEST-01 · 第 4 版/)).toBeInTheDocument();
    expect(screen.queryByText('编辑本行采购资料')).not.toBeInTheDocument();
    for (const label of ['批准采购单', '登记供应商订购结果', '登记实际付款', '登记供货变化', '回填协调结果']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(posts).toEqual([]);
  });

  it.each([
    {
      action: 'approve', label: '批准采购单', status: 'draft', next: 'approved', permission: 'purchases.approve',
      fields: [], expected: {}, absent: ['登记实际付款', '登记供货变化', '登记供应商订购结果'],
    },
    {
      action: 'register_order', label: '登记供应商订购结果', status: 'approved', next: 'ordered', permission: 'purchases.write',
      fields: [['供应商已接受订购的单据或书面确认编号', 'TEST-SUPPLIER-ORDER-NO'],
        ['供应商实际确认订购时间（本地时间）', '2031-04-05T12:30:00'], ['实际订购凭据摘要', 'e'.repeat(64)]],
      expected: { reference: 'TEST-SUPPLIER-ORDER-NO', occurredAt: new Date('2031-04-05T12:30:00').toISOString(),
        referenceSha256: 'e'.repeat(64) }, absent: ['批准采购单', '登记实际付款'],
    },
    {
      action: 'report_change', label: '登记供货变化', status: 'ordered', next: 'on_hold', permission: 'purchases.write',
      fields: [['变更类别', 'delay'], ['供应商反馈来源', 'TEST-SUPPLIER-DELAY-REF'], ['受影响的商品和具体变化', '第二批合成商品延期']],
      expected: { changeKind: 'delay', reference: 'TEST-SUPPLIER-DELAY-REF', description: '第二批合成商品延期' },
      absent: ['批准采购单', '登记实际付款', '登记供应商订购结果'],
    },
    {
      action: 'resolve_change', label: '回填协调结果', status: 'on_hold', next: 'draft', permission: 'purchases.write',
      fields: [
        ['协调结果', 'revised_terms'], ['人工与供应商协调的书面依据', 'TEST-SUPPLIER-REPLY-2'],
        ['客户对方案的回复依据', 'TEST-CUSTOMER-REPLY-2'], ['双方确认的具体结果', '采购价调整后须重新批准'],
        ['采购单价（元）', '45.50'], ['含税含费用的本行应付合计（元）', '91.00'],
      ],
      expected: {
        outcome: 'revised_terms', supplierReference: 'TEST-SUPPLIER-REPLY-2', customerReference: 'TEST-CUSTOMER-REPLY-2',
        revisedTerms: [{ orderItemId, terms: { ...terms, unitPriceCents: 4550, linePayableCents: 9100 } }],
      },
      absent: ['批准采购单', '登记实际付款'],
    },
  ] as const)('previews and confirms $action only for its role and order status', async scenario => {
    const workspace = makeWorkspace(scenario.status);
    const posts = mockWorkspace(workspace, ['purchases.read', scenario.permission], body => {
      if (body.stage === 'preview') return Response.json(preview(body, workspace));
      const updated = makeWorkspace(scenario.next);
      updated.orders[0].version = 'e'.repeat(64);
      return Response.json({ workspace: updated });
    });
    render(<PurchaseManager initialOrder={orderId} />);

    const action = await screen.findByRole('button', { name: scenario.label });
    for (const label of scenario.absent) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    fireEvent.click(action);
    for (const [label, value] of scenario.fields) fill(label, value);
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));

    const dialog = await screen.findByRole('region', { name: '操作预览' });
    expect(dialog).toHaveTextContent(scenario.label);
    expect(posts).toEqual([expect.objectContaining({
      action: scenario.action, stage: 'preview', orderId, purchaseOrderId: purchaseId, version,
      requestId: expect.any(String), ...scenario.expected,
    })]);
    expect(dialog).toHaveTextContent(version);

    fireEvent.click(within(dialog).getByRole('button', { name: `确认${scenario.label}` }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '操作预览' })).not.toBeInTheDocument());
    expect(posts).toEqual([posts[0], { ...posts[0], stage: 'confirm', actionHash }]);
  });

  it('shows exact payment terms and retries the same version, request and hash after MFA', async () => {
    const workspace = makeWorkspace('ordered');
    const posts: RequestBody[] = [];
    const mfaRequests: RequestBody[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/admin/purchases?orderId=${orderId}`) {
        return Response.json({ permissions: ['purchases.read', 'purchases.pay'], workspace });
      }
      if (url === '/api/admin/purchases' && init?.method === 'POST') {
        const body: RequestBody = JSON.parse(String(init.body));
        posts.push(body);
        if (body.stage === 'preview') return Response.json(preview(body, workspace));
        if (!body.stepUpToken) return Response.json({ error: 'Admin MFA required' }, { status: 403 });
        const paid = makeWorkspace('ordered');
        paid.orders[0] = { ...paid.orders[0], paidCents: 1234, version: 'f'.repeat(64) };
        return Response.json({ workspace: paid });
      }
      if (url === '/api/auth/security/step-up?action=admin_sensitive') {
        return Response.json({ methods: ['staging_test'], preferredMethod: 'staging_test' });
      }
      if (url === '/api/auth/security/step-up' && init?.method === 'POST') {
        const body: RequestBody = JSON.parse(String(init.body));
        mfaRequests.push(body);
        return body.challengeId
          ? Response.json({ grantToken: 'synthetic-admin-grant', verifiedAt: Date.now() })
          : Response.json({ challengeId: 'synthetic-admin-challenge', method: 'staging_test' });
      }
      throw new Error(`Unexpected test request: ${url}`);
    }));

    render(<PurchaseManager initialOrder={orderId} />);
    fireEvent.click(await screen.findByRole('button', { name: '登记实际付款' }));
    expect(screen.queryByRole('button', { name: '批准采购单' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登记供货变化' })).not.toBeInTheDocument();
    fill('本次实际支付金额（元）', '12.34');
    fill('本次付款条件已满足的依据', 'TEST-SUPPLIER-DEPOSIT-DUE');
    fill('实际付款流水或银行凭证编号', 'TEST-SUPPLIER-BANK-TRACE');
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));

    const panel = await screen.findByRole('region', { name: '操作预览' });
    expect(panel).toHaveTextContent(/本次实际付款.*12\.34.*收款方 合成供方收款账户.*TEST-SUPPLIER-DEPOSIT-DUE/);
    expect(panel).toHaveTextContent('TEST-SUPPLIER-BANK-TRACE');
    expect(panel).toHaveTextContent(version);
    expect(posts).toEqual([expect.objectContaining({
      stage: 'preview', action: 'record_payment', orderId, purchaseOrderId: purchaseId, version,
      amountCents: 1234, requestId: expect.any(String),
    })]);
    expect(mfaRequests).toEqual([]);

    fireEvent.click(within(panel).getByRole('button', { name: '确认登记实际付款' }));
    const mfaDialog = await screen.findByRole('dialog', { name: '管理员身份确认' });
    expect(posts).toEqual([posts[0], { ...posts[0], stage: 'confirm', actionHash }]);
    fireEvent.click(await within(mfaDialog).findByRole('button', { name: '开始验证' }));
    const code = await within(mfaDialog).findByLabelText('固定测试口令');
    fireEvent.change(code, { target: { value: '246810' } });
    fireEvent.click(within(mfaDialog).getByRole('button', { name: '验证并继续' }));

    expect(await screen.findByText(/本单应付.*已登记实际付款.*12\.34/)).toBeInTheDocument();
    expect(mfaRequests).toEqual([
      expect.objectContaining({ action: 'admin_sensitive', method: 'staging_test' }),
      expect.objectContaining({ action: 'admin_sensitive', challengeId: 'synthetic-admin-challenge', code: '246810' }),
    ]);
    expect(posts).toEqual([
      posts[0],
      { ...posts[0], stage: 'confirm', actionHash },
      { ...posts[0], stage: 'confirm', actionHash, stepUpToken: 'synthetic-admin-grant' },
    ]);
    expect(screen.queryByRole('region', { name: '操作预览' })).not.toBeInTheDocument();
  });
});

it('calculates the evidence digest from a local file without uploading the file', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = new TextEncoder().encode('synthetic archived receipt');
  const file = new File([bytes], 'synthetic-receipt.txt');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<DocumentDigestField name="proof" label="书证摘要" required/>);

  fireEvent.change(screen.getByLabelText('从手头文件生成书证摘要'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('书证摘要')).toHaveValue(createHash('sha256').update(bytes).digest('hex')));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('requires an exact historical acceptance preview before submitting the verification', async () => {
  const workspace = makeWorkspace();
  workspace.eligibility = { eligible: false, reason: '平台接单依据需核对', basis: null };
  const review = workspace.startReview;
  review.canVerifyAcceptance = true;
  review.acceptance = null;
  workspace.lines = [];
  const posts = mockWorkspace(workspace, ['purchases.read', 'orders.write'], body => {
    if (body.stage === 'preview') return Response.json({ preview: { actionHash, snapshot: {
      orderId, requestId: body.requestId, action: body.action, actor: { id: 'test-merchant', email: 'merchant@example.test' },
      review, operation: { reference: body.reference, description: body.description, originalActor: body.originalActor },
    } } });
    return Response.json({ workspace: makeWorkspace() });
  });
  render(<PurchaseManager initialOrder={orderId}/>);
  fireEvent.click(await screen.findByRole('button', { name: '核验历史平台接单' }));
  fill('原平台接单人', 'test-authorized-historical-merchant');
  fill('原经办人当时的平台授权依据', 'TEST-PLATFORM-ROLE-HISTORY');
  fill('原平台接单时间（本地时间）', '2031-04-05T12:30:00');
  fill('可回查的书面原件或档案出处', 'TEST-ARCHIVED-HISTORY');
  fill('书证摘要', 'a'.repeat(64));
  fill('本次核对的事实与结论', '依据原平台记录核过订单与总价');
  expect(posts).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: '查看核对预览' }));
  const preview = await screen.findByRole('region', { name: '采购启动核对预览' });
  expect(preview).toHaveTextContent('合成采购商品');
  expect(preview).toHaveTextContent('TEST-ARCHIVED-HISTORY');
  expect(posts[0]).toMatchObject({ action: 'verify_acceptance', stage: 'preview', version, originalActor: 'test-authorized-historical-merchant' });
  fireEvent.click(within(preview).getByRole('button', { name: '确认核验历史平台接单' }));
  await waitFor(() => expect(posts[1]).toEqual({ ...posts[0], stage: 'confirm', actionHash }));
});
