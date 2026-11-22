'use client';

import { useState, type ReactNode } from 'react';
import DocumentDigestField from '@/components/admin/purchases/DocumentDigestField';
import type { fulfillmentWorkspace } from '@/lib/fulfillment-parcels';

type JsonDates<T> = T extends Date ? string : T extends Array<infer Item> ? JsonDates<Item>[] :
  T extends object ? { [P in keyof T]: JsonDates<T[P]> } : T;
export type Workspace = JsonDates<Awaited<ReturnType<typeof fulfillmentWorkspace>>>;
export type SubmitIntent = (action: string, input: Record<string, unknown>) => void;
export const routeLabels: Record<string,string> = {
  supplier_to_customer: '供应商直发客户', supplier_to_libereal: '供应商发往 Libereal', libereal_to_customer: 'Libereal 转发客户', legacy_customer: '既有客户运单',
};
export const statusLabels: Record<string,string> = { dispatched: '已发出', in_transit: '运输中', partially_received: '部分签收',
  delivered: '已签收', exception: '异常待处理', carrier_delivered: '承运方报已送达', carrier_exception: '承运方报异常',
  warehouse_receipt: '本仓实收', customer_delivery: '客户签收', tracking: '人工物流进展', resolve_exception: '异常已处理',
  dispatch: '发货登记', match_carrier: '人工匹配通知', link_legacy: '接续原运单', backfill_legacy: '历史运单补核',
  confirm_shortfall: '核对实际短少、丢失或退回', dispose_receipt: '处理取消后仍保留的实收批次', shortfall: '短少或退回已核实',
  reconcile_legacy_inventory: '历史库存已核对', review_dispatch_hold: '核对误发实物的处理结果',
  pending: '客户书面处理待回复', confirmed: '已收到书面回复', identify: '核实原暂停份额', continue: '按书面决定继续履约',
  release_to_stock: '按书面决定留仓并解除预留',
  shortage: '短少', loss: '丢失', return: '退回', carrier_auto_match: '原自动匹配', carrier_match_withdrawn: '原自动匹配已暂停' };
export const inputStyle = 'min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900';
export const actionStyle = 'rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';
export function Label({ children, title }: { children: ReactNode; title: string }) {
  return <label className="grid gap-1 text-xs text-gray-700">{title}{children}</label>;
}
const read = (form: FormData,name: string) => String(form.get(name) ?? '').trim();
function evidence(form: FormData) {
  return { requestId: crypto.randomUUID(), occurredAt: new Date(read(form,'occurredAt')).toISOString(), reference: read(form,'reference'),
    documentRow: Number(read(form,'documentRow')), sha256: read(form,'sha256') };
}
export function Proof({ explanation, fixedDate }: { explanation?: string; fixedDate?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <Label title="实际发生时间（本地时间）"><input name="occurredAt" className={inputStyle} type="datetime-local" step="1" defaultValue={fixedDate} readOnly={Boolean(fixedDate)} required/></Label>
    <Label title="原件中的行号"><input name="documentRow" className={inputStyle} type="number" min={1} step={1} defaultValue={1} required/></Label>
    <Label title="物流凭据出处"><input name="reference" className={inputStyle} placeholder="运单、签收单或档案编号" required/></Label>
    <DocumentDigestField name="sha256" label="物流凭据摘要" required/>
    {explanation && <Label title={explanation}><textarea name="description" rows={2} className={inputStyle} required/></Label>}
  </div>;
}

export function DispatchForm({ view, submit, busy, readAt, canReviewHold }: {
  view: Workspace; submit: SubmitIntent; busy: boolean; canReviewHold: boolean;
  readAt: (value: string, reviewHold: boolean) => Promise<Workspace>;
}) {
  const [route,setRoute] = useState('supplier_to_customer');
  const [earlier,setEarlier] = useState(false);
  const [reviewHold,setReviewHold] = useState(false);
  const [awaitingBuyer,setAwaitingBuyer] = useState(false);
  const [date,setDate] = useState('');
  const [checked,setChecked] = useState<Workspace|null>(null);
  const [looking,setLooking] = useState(false);
  const [lookupError,setLookupError] = useState('');
  const sources = earlier ? checked : view;
  async function lookup() {
    if (!date || looking) return;
    setLooking(true);setLookupError('');setChecked(null);
    try { setChecked(await readAt(new Date(date).toISOString(),reviewHold)); }
    catch (e) { setLookupError(e instanceof Error ? e.message : '无法核对该时点的订购与实物'); }
    finally { setLooking(false); }
  }
  const forwarding = route === 'libereal_to_customer';
  const rows = !sources ? [] : forwarding ? sources.receipts.flatMap(receipt => {
    const p = sources.purchases.find(row => row.purchaseOrderId === receipt.purchaseOrderId && row.orderItemId === receipt.orderItemId);
    return p ? [{ ...p, sourceReceiptId: receipt.id, batchNumber: receipt.batchNumber, available: receipt.available, holdAllowance:receipt.holdAllowance, resendApprovalId: undefined }] : [];
  }) : [
    ...sources.purchases.filter(p => p.available > 0).map(p => ({ ...p, sourceReceiptId: null, batchNumber: null, resendApprovalId: undefined })),
    ...sources.freeResends.flatMap(resend => {
      const p = sources.purchases.find(row => row.purchaseOrderId === resend.purchaseOrderId && row.orderItemId === resend.orderItemId);
      return p ? [{ ...p, sourceReceiptId: null, batchNumber: null, available: resend.available, holdAllowance:resend.holdAllowance, resendApprovalId: resend.approvalId }] : [];
    }),
  ];
  return <div className="space-y-3">
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={earlier} disabled={looking || busy}
      onChange={event=>{setEarlier(event.target.checked);setReviewHold(false);setAwaitingBuyer(false);setChecked(null);setLookupError('');}}/>补录已实际发运的包裹</label>
    {earlier && <div className="flex flex-wrap items-end gap-2">
      <Label title="要查询的实际发运时间"><input type="datetime-local" step="1" className={inputStyle} value={date} disabled={looking}
        onChange={event=>{setDate(event.target.value);setChecked(null);setLookupError('');}}/></Label>
      <button type="button" className={actionStyle} disabled={looking || busy || !date} onClick={()=>void lookup()}>核对当时可用的货物</button>
      {canReviewHold && <label className="flex w-full items-center gap-2 text-sm">
        <input type="checkbox" checked={reviewHold} disabled={looking || busy}
          onChange={event=>{setReviewHold(event.target.checked);setAwaitingBuyer(false);setChecked(null);setLookupError('');}}/>
        核对当时未放行的实际发运
      </label>}
      {lookupError && <p role="alert" className="text-sm text-red-700">{lookupError}</p>}
      {reviewHold && <p className="w-full text-sm text-gray-700">凭原运单登记实际发运，逐项填写当时未放行的数量。客户尚未回复时，仍可登记运单和实际签收。</p>}
    </div>}
    {sources && <form key={earlier ? date : 'current'} className="space-y-3" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const lines=rows.map((row,index)=>{
      const holdAssignments=(row.holdAllowance?.assignable ?? []).map(part=>({incidentId:part.incidentId,
        quantity:Number(read(form,'held-'+index+'-'+part.incidentId))})).filter(part=>part.quantity>0);
      return {purchaseOrderId:row.purchaseOrderId,orderItemId:row.orderItemId,sourceReceiptId:row.sourceReceiptId,
        resendApprovalId:row.resendApprovalId,quantity:Number(read(form,'qty'+index)),
        holdAssignments:holdAssignments.length ? holdAssignments : undefined};
    }).filter(row=>row.quantity>0 || row.holdAssignments);
    const holdReview=reviewHold ? {supplierReference:read(form,'heldSupplierReference'),
      ...(awaitingBuyer ? {status:'pending'} : {customerReference:read(form,'heldCustomerReference')}),
      responsibility:read(form,'heldResponsibility'),description:read(form,'heldDescription'),sha256:read(form,'heldSha256')} : undefined;
    submit('dispatch',{ ...evidence(form), route, lines, carrier: read(form,'carrier'), trackingNumber: read(form,'trackingNumber'),holdReview,
      feedSource: form.has('feed') ? view.feedSource : null });
  }}>
    <Label title="发货路线"><select className={inputStyle} value={route} onChange={e => setRoute(e.target.value)}>
      {Object.entries(routeLabels).filter(([value]) => value !== 'legacy_customer').map(([value,label]) => <option key={value} value={value}>{label}</option>)}
    </select></Label>
    {rows.length ? <fieldset key={route} className="space-y-1"><legend className="text-sm font-medium">本次实际发出的商品</legend>
      {rows.map((row,index)=><div key={JSON.stringify([row.purchaseOrderId,row.orderItemId,row.sourceReceiptId,row.resendApprovalId])} className="space-y-1">
        <Label title={[row.name,row.supplier,row.purchaseOrderId,row.batchNumber && '批次 '+row.batchNumber,
          row.resendApprovalId && '已批准的免费重发',reviewHold ? '当时正常可发 '+(row.holdAllowance?.ordinarilyAvailable ?? 0)+' · 可核对实发 '+row.available : '可发 '+row.available]
          .filter(Boolean).join(' · ')}>
          <input className={inputStyle} type="number" name={'qty'+index} min={0} max={row.available} step={1} defaultValue={0}/>
        </Label>
        {reviewHold && row.holdAllowance && row.holdAllowance.ordinarilyAvailable===0 && !row.holdAllowance.assignable?.length &&
          <p className="text-sm text-amber-900">请先在采购单核实原事项与实际批次或数量。</p>}
        {reviewHold && (row.holdAllowance?.assignable ?? []).map(part=><Label key={part.incidentId}
          title={'随本包实发的暂停数量 · '+(part.reference || part.incidentId)}>
          <input className={inputStyle} type="number" name={'held-'+index+'-'+part.incidentId} min={0} max={part.quantity} step={1} defaultValue={0}/>
        </Label>)}
      </div>)}</fieldset> : <p className="text-sm text-gray-600">{forwarding ? '这笔订单还没有可转发的实际收货批次。' : '这笔订单还没有可用于本次发货的供方订购记录。'}</p>}
    {rows.length > 0 && <>
      <div className="grid gap-3 sm:grid-cols-2"><Label title="承运方"><input name="carrier" className={inputStyle}/></Label>
        <Label title="运单号"><input name="trackingNumber" className={inputStyle}/></Label></div>
      {view.feedSource && <label className="flex gap-2 text-sm"><input type="checkbox" name="feed"/>接收 {view.feedSource} 的运单回传</label>}
      <Proof fixedDate={earlier?date:undefined}/>
      {reviewHold && <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="font-medium">当时未放行的实际发运核对</legend>
        <Label title="供方对实际发运的书面确认"><input name="heldSupplierReference" className={inputStyle} required/></Label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={awaitingBuyer}
          onChange={event=>setAwaitingBuyer(event.target.checked)}/>客户书面处理尚待回复</label>
        {!awaitingBuyer && <Label title="客户对接续履约的书面回复"><input name="heldCustomerReference" className={inputStyle} required/></Label>}
        <Label title="发运偏差的责任人"><input name="heldResponsibility" className={inputStyle} required/></Label>
        <Label title={awaitingBuyer ? '实际发运情况和待办' : '已核实的偏差与后续处理结果'}><textarea name="heldDescription" className={inputStyle} required/></Label>
        <DocumentDigestField name="heldSha256" label={awaitingBuyer ? '供方确认实际发运的书证摘要' : '双方核对结论的书证摘要'} required/>
      </fieldset>}
      <button className={actionStyle} disabled={busy}>预览发货</button>
    </>}
  </form>}
  </div>;
}

export type FulfillmentCapabilities = { warehouse: boolean; shortfall: boolean };

function SelectedInventory({ line, view }: { line: Workspace['parcels'][number]['lines'][number]; view: Workspace }) {
  const options = view.inventoryChoices.find(row => row.parcelLineId === line.id);
  if (!options) return null;
  const known = line.receipts[0]?.inventoryBatch.inventoryAccountId;
  const candidates = known ? options.candidates.filter(row => row.inventoryAccountId === known) : options.candidates;
  const candidateLabel = (row: typeof candidates[number]) => [row.name, row.catalogNumber, row.spec, row.unit,
    row.packageType && [row.packageType, row.baseQuantity].join(' · '), row.inventoryAccountId ?? '首次建立该规格库存账户'].filter(Boolean).join(' · ');
  const optionValue = (row: typeof candidates[number]) => JSON.stringify([row.productId, row.variantId, row.inventoryAccountId]);
  return <div className="space-y-2">
    <p className="text-xs">批准商品 {[options.approved.brand, options.approved.catalogNumber, options.approved.spec, options.approved.unit].filter(Boolean).join(' · ')}</p>
    {candidates.length === 0 && <p className="text-sm text-amber-900">目录中没有对应规格和单位，请先核实批准书证与库存账户。</p>}
    {candidates.length === 1 && <p className="text-xs">实际库存 {candidateLabel(candidates[0])}</p>}
    {candidates.length > 1 && <>
      <Label title="实际库存账户"><select name={'identity'+line.id} className={inputStyle} defaultValue="">
        <option value="">请选择原件所列规格的库存账户</option>
        {candidates.map(row => <option key={optionValue(row)} value={optionValue(row)}>{candidateLabel(row)}</option>)}
      </select></Label>
      <Label title="库存账户核对书证出处"><input name={'identityReference'+line.id} className={inputStyle}/></Label>
      <DocumentDigestField name={'identitySha256'+line.id} label="库存账户核对书证摘要"/>
      <Label title="库存账户原件行号"><input name={'identityRow'+line.id} type="number" min={1} className={inputStyle} defaultValue={1}/></Label>
    </>}
  </div>;
}

export function EventForm({ parcel,view,capabilities,submit,busy }: {
  parcel: Workspace['parcels'][number]; view: Workspace; capabilities: FulfillmentCapabilities; submit: SubmitIntent; busy: boolean;
}) {
  const inbound = parcel.route === 'supplier_to_libereal';
  const physical = inbound ? 'warehouse_receipt' : 'customer_delivery';
  const unresolved = parcel.events.filter(e => e.kind === 'exception' && e.status === 'applied' || e.kind === 'carrier_exception' && e.status === 'awaiting_resolution');
  const lines = parcel.lines.filter(line => line.balance.pending > 0);
  const shortfallLines = parcel.lines.filter(line => line.balance.pending > 0 || line.balance.received > 0);
  const receipts = inbound ? parcel.lines.flatMap(line => line.receipts.filter(receipt => (receipt.disposable ?? receipt.remaining)>0)) : [];
  const canDispose = capabilities.warehouse && receipts.length > 0 && ['cancelled','closed'].includes(view.order.status);
  const options = [
    ...(unresolved.length ? ['resolve_exception'] : [...(lines.length && (!inbound || capabilities.warehouse) ? [physical] : []), 'exception']),
    'tracking',
    ...(capabilities.shortfall && shortfallLines.length ? ['confirm_shortfall'] : []),
    ...(canDispose ? ['dispose_receipt'] : []),
  ];
  const [selected,setSelected] = useState(options[0]);
  const [batchCounts,setBatchCounts] = useState<Record<string,number>>({});
  const [shortfallKinds,setShortfallKinds] = useState<Record<string,string>>({});
  const kind = options.includes(selected) ? selected : options[0];
  const name = (orderItemId: string) => view.order.orderItems.find(item => item.id === orderItemId)?.name ?? orderItemId;
  const batchIndexes = (id: string) => Array.from({ length: batchCounts[id] ?? 1 }, (_, index) => index);
  const suffix = (id: string, index: number) => index ? id + '-' + index : id;
  return <form className="mt-3 space-y-3" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const received = kind === physical ? lines.flatMap(line => batchIndexes(line.id).map(index => {
      const encoded = read(form,'identity'+line.id);
      const [productId,variantId,inventoryAccountId] = encoded ? JSON.parse(encoded) as (string|null)[] : [];
      const key = suffix(line.id,index);
      return { parcelLineId: line.id, quantity: Number(read(form,'qty'+key)), ...(inbound ? {
        batchNumber: read(form,'batch'+key), productId: productId ?? line.productId, variantId: variantId ?? line.variantId, inventoryAccountId,
        identityReference: read(form,'identityReference'+line.id), identitySha256: read(form,'identitySha256'+line.id),
        identityDocumentRow: encoded ? Number(read(form,'identityRow'+line.id)) : undefined,
      } : {}) };
    })).filter(row => row.quantity > 0) : [];
    const shortfall = kind === 'confirm_shortfall' ? shortfallLines.map(line => ({
      parcelLineId: line.id, quantity: Number(read(form,'shortfallQuantity'+line.id)), outcome: read(form,'shortfallKind'+line.id),
      receiptId: read(form,'returnReceipt'+line.id),
    })).filter(row => row.quantity > 0) : [];
    submit('record_event',{ ...evidence(form), parcelId: parcel.id, kind, description: read(form,'description'),
      exceptionId: read(form,'exceptionId'), lines: kind === 'confirm_shortfall' ? shortfall : received,
      ...(kind === 'confirm_shortfall' ? { supplierReference: read(form,'supplierReference'), supplierSha256: read(form,'supplierSha256'),
        customerReference: read(form,'customerReference'), customerSha256: read(form,'customerSha256') } : {}),
      ...(kind === 'dispose_receipt' ? { receiptId: read(form,'disposalReceipt'), quantity: Number(read(form,'disposalQuantity')),
        disposition: read(form,'disposition') } : {}),
    });
  }}>
    <Label title="办理事项"><select className={inputStyle} value={kind} onChange={e => setSelected(e.target.value)}>
      {options.map(value => <option key={value} value={value}>{value === 'exception' ? '登记物流异常' : value === 'resolve_exception' ? '登记异常处理结果' : statusLabels[value]}</option>)}
    </select></Label>
    {(kind === 'resolve_exception' || kind === 'confirm_shortfall' && unresolved.length > 0) && <Label title="需要处理的异常"><select className={inputStyle} name="exceptionId" required={kind === 'resolve_exception'}>
      {kind === 'confirm_shortfall' && <option value="">只核对本次短失数量</option>}
      {unresolved.map(event => <option key={event.id} value={event.id}>{event.reference} · {new Date(event.occurredAt).toLocaleString('zh-CN')}</option>)}
    </select></Label>}
    {kind === physical && <fieldset className="space-y-2"><legend className="text-sm font-medium">本次实际收到的明细</legend>
      {lines.map(line => <div className="space-y-2 rounded border border-gray-200 p-2" key={line.id}>
        {inbound && <SelectedInventory line={line} view={view}/>}
        {batchIndexes(line.id).map(index => <div className="grid gap-2 sm:grid-cols-2" key={index}>
          <Label title={index ? '第 '+(index+1)+' 批实收数量' : name(line.orderItemId)+(parcel.holdFacts?.some(hold=>hold.parcelLineId===line.id && hold.pending>0) ? ' · 待客户处理' : '')+' · 待签 '+line.balance.pending}>
            <input name={'qty'+suffix(line.id,index)} className={inputStyle} type="number" min={0} max={line.balance.pending} step={1} defaultValue={0}/>
          </Label>
          {inbound && <Label title={index ? '第 '+(index+1)+' 批实收批号' : '实收批号'}><input name={'batch'+suffix(line.id,index)} className={inputStyle}/></Label>}
        </div>)}
        {inbound && batchIndexes(line.id).length < line.balance.pending && <button type="button" className="text-sm underline"
          onClick={() => setBatchCounts(current => ({ ...current, [line.id]: (current[line.id] ?? 1)+1 }))}>再加一个实收批号</button>}
      </div>)}</fieldset>}
    {kind === 'confirm_shortfall' && <fieldset className="space-y-2"><legend className="text-sm font-medium">逐行核准实际未交付数量</legend>
      <p className="text-sm">按双方书面决定核准这批未交付数量，后续发货、采购与款项按各自凭据另行办理。</p>
      {shortfallLines.map(line => {
        const choices = [...(line.balance.pending > 0 ? ['shortage','loss'] : []),
          ...(line.balance.received > 0 && (!inbound || capabilities.warehouse && line.receipts.some(row => row.remaining > 0)) ? ['return'] : [])];
        if (!choices.length) return null;
        const current = shortfallKinds[line.id] ?? choices[0];
        return <div key={line.id} className="grid gap-2 sm:grid-cols-2">
          <Label title={name(line.orderItemId)+' · 实际结果'}><select className={inputStyle} name={'shortfallKind'+line.id}
            value={current} onChange={e => setShortfallKinds(previous => ({ ...previous,[line.id]: e.target.value }))}>
            {choices.map(choice => <option key={choice} value={choice}>{statusLabels[choice]}</option>)}
          </select></Label>
          <Label title={name(line.orderItemId)+' · 实际短失或退回数量'}><input name={'shortfallQuantity'+line.id} type="number"
            min={0} max={current === 'return' ? line.balance.received : line.balance.pending} defaultValue={0} className={inputStyle}/></Label>
          {inbound && current === 'return' && <Label title="实际退回的入仓批次"><select name={'returnReceipt'+line.id} className={inputStyle}>
            {line.receipts.filter(row => row.remaining > 0).map(row => <option key={row.id} value={row.id}>{row.inventoryBatch.batchNumber} · {row.remaining}</option>)}
          </select></Label>}
        </div>;
      })}
      <Label title="供应商或责任方书面回复"><input name="supplierReference" className={inputStyle} required/></Label>
      <DocumentDigestField name="supplierSha256" label="供应商或责任方书证摘要" required/>
      <Label title="客户书面处理决定"><input name="customerReference" className={inputStyle} required/></Label>
      <DocumentDigestField name="customerSha256" label="客户书证摘要" required/>
    </fieldset>}
    {kind === 'dispose_receipt' && <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="text-sm font-medium">核对该订单仍保留的批次实物</legend>
      <Label title="原实收批次"><select name="disposalReceipt" className={inputStyle} required>
        {receipts.map(row => <option key={row.id} value={row.id}>{row.inventoryBatch.batchNumber} · 可处理 {row.disposable ?? row.remaining}</option>)}
      </select></Label>
      <Label title="实际处置数量"><input name="disposalQuantity" type="number" min={1} className={inputStyle} required/></Label>
      <Label title="实际处置结果"><select name="disposition" className={inputStyle} required>
        <option value="released_to_stock">实物留仓，解除原订单预留</option><option value="returned_to_supplier">实物已退给供方</option>
      </select></Label>
    </fieldset>}
    <Proof explanation={kind === physical ? '实际签收人与收货情况' : '处理经过与结果'}/>
    <button className={actionStyle} disabled={busy}>预览办理结果</button>
  </form>;
}

type Parcel = Workspace['parcels'][number];

export function HoldReviewForm({ parcel,hold,view,capabilities,submit,busy }: {
  parcel: Parcel; hold: Parcel['holdFacts'][number]; view: Workspace;
  capabilities: FulfillmentCapabilities; submit: SubmitIntent; busy: boolean;
}) {
  const line=parcel.lines.find(row=>row.id===hold.parcelLineId);
  const inbound=parcel.route==='supplier_to_libereal';
  const attempts=line?.resolutions.filter(row=>row.kind==='return' && row.quantity>hold.decisions.filter(result=>result.resolutionId===row.id)
    .reduce((sum,result)=>sum+result.quantity,0)) ?? [];
  const lots=line?.receipts.filter(row=>row.remaining>0) ?? [];
  const inactive=['cancelled','closed'].includes(view.order.status);
  const options=hold.assignments ? [
    ...(!inbound || (!inactive && lots.length) ? ['continue'] : []),
    ...(inbound && inactive && capabilities.warehouse && lots.length ? ['release_to_stock'] : []),
    ...(attempts.length ? ['return'] : []),
  ] : ['identify'];
  const [selected,setSelected]=useState(options[0]);
  if (!line || hold.assignments && !hold.pending) return null;
  const kind=options.includes(selected) ? selected : options[0];
  const label=view.order.orderItems.find(row=>row.id===line.orderItemId)?.name ?? line.orderItemId;
  return <details className="rounded border border-amber-300 p-2">
    <summary className="cursor-pointer text-sm font-medium text-amber-900">{label} · {hold.assignments ? `误发待处理 ${hold.pending} 件` : '原暂停份额待核实'}</summary>
    {!kind ? <p className="mt-2 text-sm">请先登记实际入仓批次或退回凭据，再核对书面处理结果。</p> : <form className="mt-2 space-y-3" onSubmit={event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const identification=kind==='identify';
      const holdAssignments=identification ? hold.incidentIds.map(incidentId=>({incidentId,quantity:Number(read(form,'assign-'+incidentId))}))
        .filter(part=>part.quantity>0) : undefined;
      submit('record_event',{...evidence(form),parcelId:parcel.id,kind:'review_dispatch_hold',description:read(form,'description'),
        holdResponsibility:read(form,'holdResponsibility'),lines:[{parcelLineId:line.id,outcome:kind,
          quantity:identification ? hold.quantity : Number(read(form,'quantity')),incidentId:read(form,'incidentId') || undefined,
          receiptId:read(form,'decisionReceipt') || undefined,resolutionId:read(form,'decisionReturn') || undefined,holdAssignments}],
        ...(!identification ? {supplierReference:read(form,'supplierReference'),supplierSha256:read(form,'supplierSha256'),
          customerReference:read(form,'customerReference'),customerSha256:read(form,'customerSha256')} : {}),
      });
    }}>
      <Label title="误发实物处理结果"><select className={inputStyle} value={kind} onChange={e=>setSelected(e.target.value)}>
        {options.map(value=><option key={value} value={value}>{value==='return' ? '核对已实际退回的份额' : statusLabels[value]}</option>)}
      </select></Label>
      {kind==='identify' ? hold.incidentIds.map(id=><Label key={id} title={'原事项所对应的实发数量 · '+id}>
        <input name={'assign-'+id} type="number" min={0} max={hold.quantity} defaultValue={0} className={inputStyle}/>
      </Label>) : <>
        <Label title="对应原暂停事项"><select name="incidentId" className={inputStyle} required>
          {hold.pendingAssignments?.map(part=><option key={part.incidentId} value={part.incidentId}>{part.incidentId} · 待处理 {part.quantity} 件</option>)}
        </select></Label>
        <Label title="本次实际处理数量"><input name="quantity" type="number" min={1} max={hold.pending} className={inputStyle} required/></Label>
        {kind==='return' ? <Label title="已登记的实际退回"><select name="decisionReturn" className={inputStyle} required>
          {attempts.map(row=><option key={row.id} value={row.id}>{parcel.events.find(event=>event.id===row.eventId)?.reference ?? row.id} · {row.quantity} 件</option>)}
        </select></Label> : inbound && <Label title="书证对应的实收批次"><select name="decisionReceipt" className={inputStyle} required>
          {lots.map(row=><option key={row.id} value={row.id}>{row.inventoryBatch.batchNumber} · 实物 {row.remaining} 件</option>)}
        </select></Label>}
        <Label title="供方书面处理决定"><input name="supplierReference" className={inputStyle} required/></Label>
        <DocumentDigestField name="supplierSha256" label="供方处理书证摘要" required/>
        <Label title="客户书面处理决定"><input name="customerReference" className={inputStyle} required/></Label>
        <DocumentDigestField name="customerSha256" label="客户处理书证摘要" required/>
      </>}
      <Label title="本次核对的责任人"><input name="holdResponsibility" className={inputStyle} required/></Label>
      <Proof explanation="填写原件核对经过和实际结果"/>
      <button className={actionStyle} disabled={busy}>预览误发处理结果</button>
    </form>}
  </details>;
}

export function HistoricalShipmentForm({ view,submit,busy }: { view: Workspace; submit: SubmitIntent; busy: boolean }) {
  const { history, lines } = view.legacyBackfill;
  return <form className="mt-3 space-y-3" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    submit('link_legacy',{ ...evidence(form), historyId: read(form,'legacyHistory'), carrier: read(form,'legacyCarrier'),
      trackingNumber: read(form,'legacyTracking'), description: read(form,'description'),
      lines: lines.map(row => ({ orderItemId: row.orderItemId, quantity: Number(read(form,'legacyQty'+row.orderItemId)) })).filter(row => row.quantity > 0) });
  }}>
    <Label title="原订单发货记录"><select name="legacyHistory" className={inputStyle} required>
      {history.map(row => <option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleString('zh-CN')} · {row.toStatus} · {row.actorId}</option>)}
    </select></Label>
    <div className="grid gap-2 sm:grid-cols-2">
      <Label title="历史承运方"><input name="legacyCarrier" className={inputStyle}/></Label>
      <Label title="历史原运单号"><input name="legacyTracking" className={inputStyle}/></Label>
    </div>
    {lines.map(row => <Label key={row.orderItemId} title={row.name+' · 尚无运单数量 '+row.available}>
      <input name={'legacyQty'+row.orderItemId} min={0} max={row.available} type="number" defaultValue={0} className={inputStyle}/>
    </Label>)}
    <Proof explanation="原运单及实际发货明细如何核实"/>
    <button className={actionStyle} disabled={busy}>预览补核历史运单</button>
  </form>;
}

export function HistoricalInventoryForm({ row,submit,busy }: {
  row: Workspace['legacyInventory'][number]; submit: SubmitIntent; busy: boolean;
}) {
  const [outcome,setOutcome] = useState('');
  const allocate = outcome === 'allocate_recorded_movement';
  return <form className="space-y-2" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    submit('reconcile_legacy_inventory',{ ...evidence(form), parcelId: row.parcelId, parcelLineId: row.parcelLineId,
      quantity: Number(read(form,'legacyStockQuantity')), outcome, batchId: read(form,'legacyStockBatch'),
      inventoryTransactionId: read(form,'inventoryTransaction'), shipmentItemId: read(form,'stockShipmentItem'), description: read(form,'description') });
  }}>
    <Label title="经原件核实的实际发货来源"><select name="legacyStockRoute" className={inputStyle} value={outcome}
      onChange={e => setOutcome(e.target.value)} required>
      <option value="">请选择</option>
      {row.available > 0 && <><option value="warehouse_stock_shipped">本仓实际出库，核实库存扣减</option>
        <option value="external_supply_release">外部实际供货，释放原订单预留</option></>}
      {row.recordedOutsideReview > 0 && row.oldMovements.length > 0 && row.shipmentItems.length > 0
        && <option value="allocate_recorded_movement">按凭据把已记出库归到原运单商品行</option>}
    </select></Label>
    {outcome === 'warehouse_stock_shipped' && <Label title="本单原预占的实际批次"><select name="legacyStockBatch" className={inputStyle}>
      {row.noBatch > 0 && <option value="">原记录无批次 · 可核对 {row.noBatch}</option>}
      {row.lots.map(lot => <option key={lot.batchId} value={lot.batchId}>{lot.batchNumber} · 可核对 {lot.quantity}</option>)}
    </select></Label>}
    {allocate && <>
      <Label title="原库存出库流水"><select name="inventoryTransaction" className={inputStyle} required>
        {row.oldMovements.map(movement => <option key={movement.id} value={movement.id}>{movement.id} · 尚可归属 {movement.available}</option>)}
      </select></Label>
      <Label title="原运单商品行"><select name="stockShipmentItem" className={inputStyle} required>
        {row.shipmentItems.map(item => <option key={item.id} value={item.id}>{item.trackingNumber ?? item.shipmentId} · 尚可归属 {item.available}</option>)}
      </select></Label>
    </>}
    <Label title="本次核对的原预留数量"><input name="legacyStockQuantity" type="number" min={1}
      max={allocate ? row.recordedOutsideReview : row.available} className={inputStyle} required/></Label>
    <Proof explanation="原库存凭据与实际发货来源的核对结果"/>
    <button className={actionStyle} disabled={busy}>预览核对旧库存预留</button>
  </form>;
}

export function EvidenceAction({ action, fields, label, submit, busy }: {
  action: 'link_legacy'|'match_notice'; fields: Record<string,string>; label: string; submit: SubmitIntent; busy: boolean;
}) {
  return <form className="mt-2 space-y-2" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    submit(action,{ ...fields, ...evidence(form), description: read(form,'description') });
  }}><Proof explanation="核对依据与结果"/><button className={actionStyle} disabled={busy}>{label}</button></form>;
}
