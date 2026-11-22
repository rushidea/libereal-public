import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminOrdersPage from '@/app/admin/orders/page';
import CustomerOrdersPage from '@/app/account/orders/page';
import CustomerOrderDetailPage from '@/app/account/orders/[id]/page';

const navigation = vi.hoisted(() => ({
  role: 'admin',
  router: { push: vi.fn(), replace: vi.fn() },
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.search,
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: navigation.role, email: 'operator@example.test' } }, status: 'authenticated' }),
}));
vi.mock('@/context/CustomerNotificationsContext', () => ({ useMarkNotificationModuleRead: vi.fn() }));
vi.mock('@/components/AdaptiveHeader', () => ({ default: () => null }));
vi.mock('@/components/mobile/MobileBottomNav', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));

const orderId = 'TEST-LOGISTICS-ORDER';
const customerEmail = 'recipient@example.test';
const orderItemId = 'TEST-LOGISTICS-ORDER-LINE';
const purchaseOrderId = 'TEST-LOGISTICS-PO';
const catalogNumber = 'TEST-LOGISTICS-SKU';
const supplier = '合成供方';
const customerAddress = '合成客户收货地址';
const carrier = '合成承运人';
const outboundTracking = 'TEST-OUTBOUND-WAYBILL';
const inboundTracking = 'TEST-INBOUND-WAYBILL';
const source = 'TEST-CARRIER-FEED';
const lineId = 'TEST-INBOUND-LINE';
const batchNumber = 'TEST-RECEIVED-LOT';
const secondBatchNumber = 'TEST-NEXT-RECEIVED-LOT';
const inboundReference = 'TEST-PRIVATE-INBOUND-PROOF';
const digest = 'a'.repeat(64);
const actionHash = 'b'.repeat(64);
const contractVersion = 'c'.repeat(64);
const localTime = '2031-05-01T09:12:10';
const orderPath = `/api/admin/orders/${orderId}`;
const fulfillmentPath = `${orderPath}/fulfillment`;

const item = { id: orderItemId, productId: 'test-product', name: '合成采购品', brand: '合成品牌', catalogNumber, price: 100, quantity: 3 };
const order = {
  id: orderId, email: customerEmail, name: '合成收件人', institution: '合成机构', phone: '00000000000',
  status: 'confirmed', paymentMethod: 'bank_transfer', shippingMethod: 'logistics', createdAt: '2031-04-01T00:00:00.000Z',
  subtotal: 300, total: 300, items: [item], shipments: [], events: [], statusHistory: [], approvalPreview: null, acceptedAt: null,
  adjustments: [], pointsDiscount: 0, pointsPersonal: 0, pointsGroup: 0, payment: null, receivable: null,
};
const purchase = {
  purchaseOrderId, orderItemId, name: item.name, supplier, catalogNumber, productId: item.productId, variantId: null,
  contractVersion, orderedAt: '2031-04-15T00:00:00.000Z', available: 3,
};

function parcel(route: 'supplier_to_customer' | 'supplier_to_libereal', receivedQuantity = 0) {
  const inbound = route === 'supplier_to_libereal';
  return {
    id: inbound ? 'TEST-INBOUND-PARCEL' : 'TEST-OUTBOUND-PARCEL',
    route, carrier, trackingNumber: inbound ? inboundTracking : outboundTracking, feedSource: source,
    status: receivedQuantity ? 'partially_received' : 'dispatched', dispatchedAt: '2031-04-30T00:00:00.000Z',
    reference: inbound ? inboundReference : 'TEST-OUTBOUND-PROOF',
    events: receivedQuantity ? [{
      id: 'test-receipt-event', kind: 'warehouse_receipt', source: 'staff', status: 'applied', reference: 'TEST-WAREHOUSE-PROOF',
      occurredAt: '2031-05-01T01:12:10.000Z', details: JSON.stringify({ description: '库管按合成签收单清点实收' }),
    }] : [],
    lines: [{
      id: inbound ? lineId : 'TEST-OUTBOUND-LINE', orderItemId, purchaseOrderId, productId: item.productId, variantId: null,
      quantity: inbound ? 3 : 2, receivedQuantity,
      balance: { pending: (inbound ? 3 : 2)-receivedQuantity, received: receivedQuantity, shipped: inbound ? 3 : 2 },
      receipts: receivedQuantity ? [batchNumber,secondBatchNumber].map((value,index)=>({
        id: 'test-receipt-'+index, quantity: 1, forwardedQuantity: 0, releasedQuantity: 0, remaining: 1, inventoryBatch: { batchNumber:value },
      })) : [],
    }],
  };
}

type OperationInput = {
  requestId: string;
  lines: Array<{ quantity: number; purchaseOrderId?: string; orderItemId?: string }>;
};
type OperationRequest = {
  action: string;
  stage: string;
  input: OperationInput;
  actionHash?: string;
  stepUpToken?: string;
};

function mockAdmin(permissions: string[] | Promise<string[]>, startingInbound = false) {
  const operations: OperationRequest[] = [];
  const reads = { workspace: 0, detail: 0 };
  const notice = {
    id: 'test-awaiting-notice', carrier, trackingNumber: 'TEST-UNMATCHED-WAYBILL',
    source: 'carrier/' + source, reference: 'TEST-UNMATCHED-WAYBILL-PROOF',
    occurredAt: '2031-05-01T00:00:00.000Z', description: '合成等待原运单核对',
  };
  let operationApplied = false;
  const fetchMock = vi.fn(async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = String(resource);
    if (url === '/api/admin/access?view=current') return Response.json({ permissions: await permissions });
    if (url.startsWith('/api/admin/orders?')) return Response.json({ orders: [order], total: 1, statusCounts: {} });
    if (url === orderPath) {
      reads.detail += 1;
      return Response.json({ order });
    }
    if (url === '/api/admin/fulfillment/notices') return Response.json({ notices: [notice], next: null });
    if ((url === fulfillmentPath || url.startsWith(fulfillmentPath+'?dispatchAt=')) && !init?.method) {
      reads.workspace += 1;
      return Response.json({ capabilities: { warehouse: Array.isArray(permissions) && permissions.includes('inventory.write'), shortfall: false }, workspace: {
        order: { id: orderId, status: 'confirmed', orderItems: [item] },
        purchases: [purchase], receipts: [], legacyShipments: [], legacyBackfill: { history: [], lines: [] },
        legacyInventory: [], inventoryChoices: [], unmatched: [], freeResends: [], feedSource: source,
        parcels: startingInbound ? [parcel('supplier_to_libereal', operationApplied ? 2 : 0)] :
          operationApplied ? [parcel('supplier_to_customer')] : [],
      } });
    }
    if (url === fulfillmentPath && init?.method === 'POST') {
      const body: OperationRequest = JSON.parse(String(init.body));
      operations.push(body);
      if (body.stage === 'preview') {
        const lines = body.input.lines.map(line => ({
          ...line, orderItemId, purchaseOrderId, catalogNumber,
          ...(body.action === 'dispatch' ? { supplier, name: item.name, contractVersion } : { priorReceived: 0 }),
        }));
        return Response.json({ preview: { actionHash, snapshot: {
          orderId, actorId: 'test-operator', ...body.input,
          ...(body.action === 'dispatch' ? { recipient: { party: 'customer', email: customerEmail, deliveryAddress: { address: customerAddress } } } :
            { route: 'supplier_to_libereal', priorStatus: 'dispatched' }),
          lines,
        } } });
      }
      expect(body).toMatchObject({ stage: 'confirm', stepUpToken: 'test-grant-from-mfa', actionHash });
      operationApplied = true;
      return Response.json({ applied: true });
    }
    if (url === '/api/auth/security/step-up?action=admin_sensitive') {
      return Response.json({ methods: ['totp'], preferredMethod: 'totp' });
    }
    if (url === '/api/auth/security/step-up' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ action: 'admin_sensitive', method: 'totp' });
      if (!body.challengeId) return Response.json({ challengeId: 'test-challenge' });
      expect(body).toMatchObject({ challengeId: 'test-challenge', code: '654321' });
      return Response.json({ grantToken: 'test-grant-from-mfa', verifiedAt: Date.now() });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { operations, reads, notice };
}

async function openAdminFulfillment() {
  render(<AdminOrdersPage/>);
  fireEvent.click((await screen.findAllByText(orderId))[0]);
  fireEvent.click((await screen.findAllByRole('button', { name: '查看履约物流' }))[0]);
  return within(screen.getAllByRole('region', { name: '履约物流' })[0]);
}

function fill(scope: ReturnType<typeof within>, label: string | RegExp, value: string) {
  fireEvent.change(scope.getByLabelText(label), { target: { value } });
}

function fillEvidence(scope: ReturnType<typeof within>, reference: string) {
  fill(scope, '实际发生时间（本地时间）', localTime);
  fill(scope, '原件中的行号', '4');
  fill(scope, '物流凭据出处', reference);
  fill(scope, '物流凭据摘要', digest);
}

function previewField(scope: ReturnType<typeof within>, label: string, value: string) {
  expect(scope.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(value);
}

async function verifyWithDialog(operations: OperationRequest[]) {
  const preview = within(await screen.findByRole('region', { name: '物流操作预览' }));
  fireEvent.click(preview.getByRole('button', { name: '确认并验证身份' }));
  const dialog = within(await screen.findByRole('dialog'));
  const start = await dialog.findByRole('button', { name: '开始验证' });
  expect(operations.map(operation => operation.stage)).toEqual(['preview']);
  fireEvent.click(start);
  fireEvent.change(await dialog.findByLabelText('验证器应用中的验证码'), { target: { value: '654321' } });
  expect(operations.map(operation => operation.stage)).toEqual(['preview']);
  fireEvent.click(dialog.getByRole('button', { name: '验证并继续' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.role = 'admin';
});

describe('fulfillment in the existing order pages', () => {
  it('shows the package and carrier queue without booking forms before or after read-only permissions arrive', async () => {
    const access = Promise.withResolvers<string[]>();
    const { operations, notice } = mockAdmin(access.promise, true);
    const panel = await openAdminFulfillment();
    expect(await panel.findByText(new RegExp(inboundTracking))).toBeInTheDocument();
    expect(panel.queryByText('办理本包裹')).toBeNull();
    expect(panel.queryByText('登记采购发货或转发')).toBeNull();

    await act(async () => { access.resolve(['orders.read']); });
    expect(panel.queryByText('办理本包裹')).toBeNull();
    expect(panel.queryByText('登记采购发货或转发')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '待核物流通知' }));
    const queue = within(screen.getByRole('region', { name: '待核物流通知' }));
    expect(await queue.findByText(new RegExp(notice.reference))).toBeInTheDocument();
    expect(queue.getByText(/按运单核对原订单/)).toBeInTheDocument();
    expect(operations).toEqual([]);
  });

  it('uses the stated shipment time to look up former capacity and binds it to the normal waybill preview',async()=>{
    const {operations} = mockAdmin(['orders.read','orders.write']);
    const panel = await openAdminFulfillment();
    fireEvent.click(await panel.findByText('登记采购发货或转发',{selector:'summary'}));
    fireEvent.click(panel.getByLabelText('补录已实际发运的包裹'));
    fill(panel,'要查询的实际发运时间',localTime);
    expect(panel.queryByRole('button',{name:'预览发货'})).not.toBeInTheDocument();
    fireEvent.click(panel.getByRole('button',{name:'核对当时可用的货物'}));
    await panel.findByLabelText(/合成采购品.*可发 3/);
    expect(panel.getByLabelText('实际发生时间（本地时间）')).toHaveAttribute('readonly');
    fill(panel,/合成采购品.*可发 3/,'1');
    fill(panel,'物流凭据出处','TEST-LATE-ORIGINAL-WAYBILL');
    fill(panel,'物流凭据摘要',digest);
    fireEvent.click(panel.getByRole('button',{name:'预览发货'}));
    await screen.findByRole('region',{name:'物流操作预览'});
    expect(operations[0]).toMatchObject({action:'dispatch',stage:'preview',input:{occurredAt:new Date(localTime).toISOString(),
      reference:'TEST-LATE-ORIGINAL-WAYBILL',lines:[{purchaseOrderId,quantity:1}]}});
  });

  it('shows the source, recipient, SKU, quantity and proof before dispatch, then rereads the confirmed waybill', async () => {
    const { operations, reads } = mockAdmin(['orders.read', 'orders.write']);
    const panel = await openAdminFulfillment();
    fireEvent.click(await panel.findByText('登记采购发货或转发', { selector: 'summary' }));
    expect(panel.getByLabelText('发货路线')).toHaveValue('supplier_to_customer');
    fill(panel, /合成采购品.*合成供方.*可发 3/, '2');
    fill(panel, '承运方', carrier);
    fill(panel, '运单号', outboundTracking);
    fireEvent.click(panel.getByLabelText(/接收 TEST-CARRIER-FEED 的运单回传/));
    fillEvidence(panel, 'TEST-OUTBOUND-PROOF');
    fireEvent.click(panel.getByRole('button', { name: '预览发货' }));

    const preview = within(await screen.findByRole('region', { name: '物流操作预览' }));
    previewField(preview, '供方', supplier);
    previewField(preview, '采购单', purchaseOrderId);
    previewField(preview, '物流信息来源', source);
    previewField(preview, '发货路线', '供应商直发客户');
    previewField(preview, '收货方类别', '客户');
    previewField(preview, '联系邮箱', customerEmail);
    previewField(preview, '地址', customerAddress);
    previewField(preview, '货号', catalogNumber);
    previewField(preview, '数量', '2');
    previewField(preview, '凭据出处', 'TEST-OUTBOUND-PROOF');
    previewField(preview, '凭据摘要', digest);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ action: 'dispatch', stage: 'preview', input: {
      requestId: expect.any(String), route: 'supplier_to_customer', carrier, trackingNumber: outboundTracking, feedSource: source,
      documentRow: 4, occurredAt: new Date(localTime).toISOString(), reference: 'TEST-OUTBOUND-PROOF', sha256: digest,
      lines: [{ purchaseOrderId, orderItemId, quantity: 2, sourceReceiptId: null }],
    } });

    await verifyWithDialog(operations);
    expect(await panel.findByText(new RegExp(outboundTracking), { selector: 'article p' })).toBeInTheDocument();
    expect(operations[1]).toEqual({ ...operations[0], stage: 'confirm', actionHash, stepUpToken: 'test-grant-from-mfa' });
    expect(reads.workspace).toBe(2);
    await waitFor(() => expect(reads.detail).toBeGreaterThanOrEqual(2));
  });

  it('records two actual batches for one part-received line in a single confirmed warehouse receipt', async () => {
    const { operations, reads } = mockAdmin(['orders.read', 'orders.write', 'inventory.write'], true);
    const panel = await openAdminFulfillment();
    const booking = await panel.findByText('办理本包裹', { selector: 'summary' });
    fireEvent.click(booking);
    const form = within(booking.parentElement!);
    expect(form.getByLabelText('办理事项')).toHaveValue('warehouse_receipt');
    fill(form, /合成采购品 · 待签 3/, '1');
    fill(form, '实收批号', batchNumber);
    fireEvent.click(form.getByRole('button',{name:'再加一个实收批号'}));
    fill(form,'第 2 批实收数量','1');
    fill(form,'第 2 批实收批号',secondBatchNumber);
    fill(form, '实际签收人与收货情况', '库管按合成签收单清点实收');
    fillEvidence(form, 'TEST-WAREHOUSE-PROOF');
    fireEvent.click(form.getByRole('button', { name: '预览办理结果' }));

    const preview = within(await screen.findByRole('region', { name: '物流操作预览' }));
    previewField(preview, '发货路线', '供应商发往 Libereal');
    previewField(preview, '事项', '本仓实收');
    expect(preview.getAllByText('实际批次',{selector:'dt'}).map(node=>node.nextElementSibling?.textContent)).toEqual([batchNumber,secondBatchNumber]);
    expect(preview.getAllByText('货号',{selector:'dt'}).map(node=>node.nextElementSibling?.textContent)).toEqual([catalogNumber,catalogNumber]);
    expect(preview.getAllByText('数量',{selector:'dt'}).map(node=>node.nextElementSibling?.textContent)).toEqual(['1','1']);
    previewField(preview, '凭据出处', 'TEST-WAREHOUSE-PROOF');
    expect(operations[0]).toMatchObject({ action: 'record_event', stage: 'preview', input: {
      kind: 'warehouse_receipt', parcelId: 'TEST-INBOUND-PARCEL', documentRow: 4, sha256: digest,
      lines: [{ parcelLineId: lineId, productId: item.productId, quantity: 1, batchNumber },
        { parcelLineId: lineId, productId: item.productId, quantity: 1, batchNumber:secondBatchNumber }],
    } });

    await verifyWithDialog(operations);
    expect(await panel.findByText(new RegExp('批次 ' + batchNumber))).toBeInTheDocument();
    expect(panel.getByText(new RegExp('批次 ' + secondBatchNumber))).toBeInTheDocument();
    expect(panel.getByText('部分签收')).toBeInTheDocument();
    expect(panel.getByText(/已签 2 \/ 3/)).toBeInTheDocument();
    expect(operations[1]).toEqual({ ...operations[0], stage: 'confirm', actionHash, stepUpToken: 'test-grant-from-mfa' });
    expect(reads.workspace).toBe(2);
  });

  it('renders only the customer shipments in the member order list and detail view', async () => {
    navigation.role = 'customer';
    const deliveredWaybill = 'TEST-CUSTOMER-RECEIPT-WAYBILL';
    const customerOrder = {
      ...order, status: 'shipped',
      shipments: [{
        id: 'test-public-in-transit', method: 'logistics', carrier, trackingNumber: outboundTracking,
        deliveredAt: null, fulfillmentParcel: { status: 'in_transit' },
      }, {
        id: 'test-public-delivered', method: 'logistics', carrier, trackingNumber: deliveredWaybill,
        deliveredAt: '2031-05-01T02:13:00.000Z', fulfillmentParcel: { status: 'delivered' },
      }],
      parcels: [parcel('supplier_to_libereal', 2)],
    };
    const fetchMock = vi.fn(async (resource: RequestInfo | URL) => {
      if (String(resource) === '/api/orders') return Response.json([customerOrder]);
      if (String(resource) === `/api/orders/${orderId}`) return Response.json(customerOrder);
      throw new Error(`Unexpected member request: ${resource}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const accountList = render(<CustomerOrdersPage/>);
    fireEvent.click((await screen.findAllByRole('button', { name: '详情' }))[0]);
    expect((await screen.findAllByText(new RegExp(outboundTracking))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/运输中/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已签收/).length).toBeGreaterThan(0);
    expect(screen.queryByText(new RegExp(inboundTracking))).toBeNull();
    expect(screen.queryByText(new RegExp(inboundReference))).toBeNull();
    accountList.unmount();

    const params = Promise.resolve({ id: orderId });
    await act(async () => {
      render(<Suspense fallback={null}><CustomerOrderDetailPage params={params}/></Suspense>);
    });
    expect(await screen.findByText(new RegExp(outboundTracking))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(deliveredWaybill))).toBeInTheDocument();
    expect(screen.getByText(/运输中/)).toBeInTheDocument();
    expect(screen.getByText(/已签收/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(inboundTracking))).toBeNull();
    expect(screen.queryByText(new RegExp(inboundReference))).toBeNull();
    expect(screen.queryByText(new RegExp(batchNumber))).toBeNull();
    expect(screen.queryByRole('button', { name: '查看履约物流' })).toBeNull();
  });
});
