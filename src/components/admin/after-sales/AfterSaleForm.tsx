'use client';

import { useState, type FormEvent } from 'react';
import DocumentDigestField from '@/components/admin/purchases/DocumentDigestField';
import { button, field, primary, money } from '@/components/admin/purchases/PurchaseLineForm';
import { afterSaleActions, afterSaleChannels, afterSaleIssues, afterSaleRemedies, hasChoice, type AfterSaleAction } from '@/lib/after-sale-options';
import type { afterSaleInvoiceChoices, afterSaleReissueViews } from '@/lib/after-sale-invoices';
import type { afterSaleAdminView } from '@/lib/after-sale-workspace';
import type { refundTerms, refundPosition } from '@/lib/after-sale-refunds';

type AdminDesk = ReturnType<typeof afterSaleAdminView>;
type Reissue = Awaited<ReturnType<typeof afterSaleReissueViews>>[number]['invoiceReissue'];

export type Desk = Omit<AdminDesk,'cases'> & {
  cases:Array<AdminDesk['cases'][number]&{invoiceReissue?:Reissue|null}>;
  refundDrafts: Array<{caseId:string;terms:ReturnType<typeof refundTerms>;position:Awaited<ReturnType<typeof refundPosition>>}>;
  refundSources?: Array<{id:string;tradeNo:string;amountCents:number;arrivedAt:string;customerKey:string|null}>;
  invoiceChoices?: Array<Omit<Awaited<ReturnType<typeof afterSaleInvoiceChoices>>[number],'amountCents'> & {amountCents:number|null}>;
};
type Case = Desk['cases'][number];
export type FormInput = { orderId:string;caseId?:string;action:AfterSaleAction;requestId:string;data:Record<string,unknown> };
const shortfallActions: AfterSaleAction[]=['link_shortfall','open'];
const inYuan=(s: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw Error('请填写最多两位小数的人民币金额');
  const [i,f='']=s.split('.');const result=Number(i)*100+Number(f.padEnd(2,'0'));
  if (!Number.isSafeInteger(result)) throw Error('请核对人民币金额');
  return result;
};
function Input({name,label,required=true,type='text',value,max}: {name:string;label:string;required?:boolean;type?:string;value?:string|number;max?:number}) {
  return <label className="grid gap-1 text-sm">{label}<input className={field} name={name} type={type} required={required} defaultValue={value}
    min={type==='number'?1:undefined} max={max} step={type==='number'?1:type==='datetime-local'?'0.001':undefined} maxLength={type==='text'?2000:undefined}/></label>;
}
const methodLabels={bank:'银行转账',alipay:'支付宝',other:'书面约定的其他渠道'};
const physicalLabels={delivery:'补件实际签收',return:'实际退回'};
function Select({name,label,options,initial,onChange,required=true}:{name:string;label:string;options:Record<string,string>;initial?:string;onChange?:(v:string)=>void;required?:boolean}) {
  return <label className="grid gap-1 text-sm">{label}<select className={field} name={name} defaultValue={initial??''} required={required} onChange={event=>onChange?.(event.target.value)}>
    <option value="">请选择</option>{Object.entries(options).map(([v,title])=><option key={v} value={v}>{title}</option>)}</select></label>;
}

export default function AfterSaleForm({view,current,action,chosenLoss,busy,onPreview,onCancel}:{
  view:Desk;current?:Case;action:AfterSaleAction;chosenLoss?:string;busy:boolean;onPreview:(input:FormInput)=>Promise<void>;onCancel:()=>void;
}) {
  const [lossId,setLoss]=useState(chosenLoss??'');
  const [lineId,setLine]=useState(current?.orderItemId??view.shortfalls.find(row=>row.resolutionId===chosenLoss)?.orderItemId??'');
  const revisingReissue=action==='agreement'&&current?.customerState==='awaiting_invoice_reissue';
  const [remedy,setRemedy]=useState(revisingReissue?'invoice':'');const [outcome,setOutcome]=useState('');const [error,setError]=useState('');
  const [selectedInvoice,setSelectedInvoice]=useState('');
  const [reviewReissueLink,setReviewReissueLink]=useState(false);
  const [predecessorId,setPredecessorId]=useState('');
  const [supplierScope,setSupplierScope]=useState(current?.supplierScopes?.length===1?current.supplierScopes[0].key:'');
  const [physical,setPhysical]=useState('');const [parcelId,setParcel]=useState('');
  const [selectedPayment,setSelectedPayment]=useState('');
  const [channel,setChannel]=useState(chosenLoss?'fulfillment':'');const [refundResult,setRefundResult]=useState('');
  const loss=view.shortfalls.find(row=>row.resolutionId===lossId);
  const linked=view.shortfalls.find(row=>row.resolutionId===(current?.shortfallId??lossId));
  const draft=view.refundDrafts.find(row=>row.caseId===current?.id);
  const original=action==='link_shortfall'||(action==='open'&&channel==='fulfillment') ? loss : null;
  const actualLines=view.deliveries.filter(l=>l.orderItemId===lineId && l.route!=='supplier_to_libereal');
  const selectedParcel=actualLines.find(l=>l.id===parcelId);
  const originalChoices=Object.fromEntries(actualLines.filter(l=>!l.afterSaleApprovalId).map(l=>[l.id,l.reference+' · '+l.quantity+' 件']));
  const originalShares=current?.originalParcelShares ?? [];
  const originalOnly=actualLines.filter(line=>!originalShares.length || originalShares.some(part=>part.parcelLineId===line.id));
  const assigned=Object.fromEntries(Object.entries(originalChoices).filter(([id])=>originalShares.some(part=>part.parcelLineId===id)));
  const paidReplacements=(view.replacements ?? []).filter(row=>row.orderItemId===lineId&&(!linked||row.shortfallId===linked.resolutionId));
  const decisionInvoice=current?.events.find(event=>event.id===current.agreementId)?.operation?.invoice as {
    allocationId?:string;invoiceId?:string;correctionId?:string;originalNumber?:string;replacementAmountCents?:number}|undefined;
  const currentCorrection=current?.events.findLast(event=>event.action==='invoice_outcome'
    && (event.operation?.agreementId===current.agreementId||event.id===decisionInvoice?.correctionId));
  const selectedScope=current?.supplierScopes?.find(scope=>scope.key===supplierScope);
  const exchangeSubjects=action==='approve_exchange' ? view.cases.filter(item=>item.id===current?.id
    || item.customerState==='awaiting_fulfillment'&&item.events.some(event=>event.id===item.agreementId&&event.operation?.remedy==='exchange'
      && !event.operation?.replacements)) : [];
  const documentParcels=exchangeSubjects.flatMap(item=>{
    const parts=item.originalParcelShares??[];
    return [...new Set(parts.map(part=>part.parcelLineId))].flatMap(id=>{
      const original=view.deliveries.find(line=>line.id===id);
      if (!original) return [];
      const source=item.supplierScopes?.find(scope=>scope.parcelLineId===id);
      const selectedSupplier=current?.supplierScopes?.find(scope=>scope.parcelLineId===selectedParcel?.id)?.supplier;
      if (source?.supplier&&selectedSupplier&&source.supplier!==selectedSupplier) return [];
      return [{ key:item.id+'/'+id,id,caseId:item.id,label:original.reference+' · '+item.id,
        count:parts.filter(part=>part.parcelLineId===id).reduce((sum,part)=>sum+part.quantity,0) }];
    });
  });
  const previousReissues=(current?.events??[]).filter(event=>event.action==='invoice_reissue'
    && event.operation?.financeEventId===currentCorrection?.operation?.financeEventId);
  const reissueRemaining=current?.invoiceReissue?.remainingCents ?? (decisionInvoice?.replacementAmountCents==null?null
    : decisionInvoice.replacementAmountCents-previousReissues.reduce((sum,event)=>sum+Number(event.operation?.amountCents??0),0));
  const returnedQuantity=current?.events.filter(event=>event.action==='physical'&&event.operation?.result==='return')
    .reduce((sum,event)=>sum+Number(event.operation?.quantity??0),0)??0;
  const refundQuantity=returnedQuantity?Math.min(returnedQuantity,current?.quantity??returnedQuantity):current?.quantity;
  const selectedPortions=(view.invoiceChoices?.find(row=>row.id===selectedInvoice)?.linePortions??[]).filter(part=>
    part.lines.length>1&&part.lines.some(goods=>goods.orderItemId===lineId));
  const releaseIds=new Set(current?.events.filter(event=>event.action==='release_refund_source').map(event=>event.operation?.reviewId));
  const activeReview=current?.events.findLast(event=>event.action==='review_refund_source'&&!releaseIds.has(event.id));
  const receipt=action==='invoice_outcome' ? view.invoiceChoices?.find(row=>row.id===decisionInvoice?.allocationId)?.correction : null;
  const invoiceOptions=Object.fromEntries((view.invoiceChoices??[])
    .filter(row=>action!=='invoice_reissue'||row.invoiceId!==decisionInvoice?.invoiceId)
    .map(row=>[row.id,[row.number,row.issuer,row.planReference,row.amountCents==null?null:money(row.amountCents),
      new Date(row.issuedAt).toLocaleDateString('zh-CN')].filter(Boolean).join(' · ')]));
  const checkedInvoice=(view.invoiceChoices??[]).find(row=>row.id===selectedInvoice);
  const predecessors=(view.invoiceChoices??[]).filter(row=>row.correction?.outcome==='voided'&&row.invoiceId!==checkedInvoice?.invoiceId);
  const predecessor=predecessors.find(row=>row.id===predecessorId);
  const payment=(view.refundSources??[]).find(item=>item.id===selectedPayment);
  const approvalId=current?.events.findLast(event=>event.action==='approve_refund')?.id;
  const results=new Map(current?.events.filter(event=>event.action==='refund_result' && event.operation?.approvalId===approvalId
    && typeof event.operation?.referenceNo==='string').map(event=>[String(event.operation!.referenceNo).normalize('NFKC').replace(/\s+/gu,'').toUpperCase(),event])??[]);
  const pendingInstructions=[...results.values()].filter(event=>event.operation?.result==='pending');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError('');
    try {
      const record=Object.fromEntries(new FormData(event.currentTarget).entries());
      const data:Record<string,unknown>={};
      for(const [key,value] of Object.entries(record)) {
        if (['replacement:','invoicePortion:','exchangeDocument:'].some(prefix=>key.startsWith(prefix))) continue;
        if (typeof value==='string'&&value.trim()) data[key]=value.trim();
      }
      for(const key of ['quantity','documentRow','refundQuantity']) if(data[key]!=null) data[key]=Number(data[key]);
      for(const key of ['relatedCents','amountCents','transferTotalCents','replacementAmountCents']) if(typeof data[key]==='string') data[key]=inYuan(data[key]);
      if(record.reviseAgreement&&current?.agreementId)data.revisesAgreementId=current.agreementId;
      if(action==='stop_refund') Object.assign(data,{confirmStopped:record.confirmStopped==='on',
        pendingResultIds:new FormData(event.currentTarget).getAll('pendingResultIds')});
      if(action==='approve_exchange') {
        data.freeOfCharge=record.freeOfCharge==='on';
        const shares=documentParcels.flatMap(part=>{
          const number=Number(record['exchangeDocument:'+part.key]);
          return number>0?[{caseId:part.caseId,parcelLineId:part.id,quantity:number}]:[];
        });
        if(shares.length)data.supplierDocumentShares=shares;
      }
      if(action==='verify_invoice_line'&&!reviewReissueLink&&selectedPortions.length>1) data.portionAmounts=selectedPortions.flatMap(part=>{
        const value=record['invoicePortion:'+part.invoiceScopeId];
        return typeof value==='string'&&value.trim()?[{scopeId:part.invoiceScopeId,amountCents:inYuan(value.trim())}]:[];
      });
      if(action==='supplier'&&selectedScope) {
        data.purchaseOrderId=selectedScope.purchaseOrderId;
        if(selectedScope.parcelLineId)data.originalParcelLineId=selectedScope.parcelLineId;
      }
      if(action==='release_refund_source') Object.assign(data,{reviewId:activeReview?.id,confirmUnsent:record.confirmUnsent==='on'});
      if(action==='invoice_reissue'&&record.confirmReplacementEvidence==='on') Object.assign(data,{
        confirmReplacementEvidence:true,financeEventId:data.financeEventId??currentCorrection?.operation?.financeEventId});
      if(action==='agreement'&&['exchange','resend'].includes(remedy)) {
        const replacementPurchaseShares=paidReplacements.flatMap(item=>{
          const qty=Number(record['replacement:'+item.purchaseOrderId]);
          return qty>0?[{purchaseOrderId:item.purchaseOrderId,quantity:qty}]:[];
        });
        if(replacementPurchaseShares.length)data.replacementPurchaseShares=replacementPurchaseShares;
      }
      if(action==='attribute_resend') data.approvalId=selectedParcel?.approvalId;
      if(original) Object.assign(data,{occurredAt:original.occurredAt,reference:original.reference,sha256:original.sha256,documentRow:original.documentRow});
      else if(receipt) Object.assign(data,{financeEventId:receipt.id,occurredAt:receipt.occurredAt,reference:receipt.reference,sha256:receipt.sha256});
      else if(typeof data.occurredAt==='string') data.occurredAt=new Date(data.occurredAt).toISOString();
      if(action==='open'&&original) Object.assign(data,{channel:'fulfillment',issue:original.kind==='return'?'return':'shortage',orderItemId:original.orderItemId});
      await onPreview({orderId:view.order.id,caseId:current?.id,action,requestId:crypto.randomUUID(),data});
    } catch(err) {setError(err instanceof Error?err.message:'暂时无法预览');}
  }
  const approved=Object.fromEntries((linked?.approved??[]).map(a=>[a.id,a.id+' · 已准 '+a.quantity+' 件，已发 '+a.dispatched+' 件']));
  return <form onSubmit={submit} className="space-y-4 rounded border border-slate-300 bg-white p-4">
    <h3 className="font-semibold">{afterSaleActions[action]}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      {action==='open'&&<><Select name="orderItemId" label="原订单商品" initial={lineId} options={Object.fromEntries(view.lines.map(l=>[l.id,l.name+' · '+l.quantity+' 件']))} onChange={v=>{setLine(v);setLoss('');}}/>
        <Select name="channel" label="需求来源" initial={channel} options={{email:afterSaleChannels.email,koncket:afterSaleChannels.koncket,handoff:afterSaleChannels.handoff,fulfillment:afterSaleChannels.fulfillment}} onChange={setChannel}/>
        {channel!=='fulfillment'&&<><Select name="issue" label="问题类别" options={afterSaleIssues}/>
          {Object.keys(originalChoices).length>0&&<Select name="originalParcelLineId" label="实际受影响的原包裹（可先留待核对）" options={originalChoices} required={false}/>}</>}</>}
      {shortfallActions.includes(action)&&(action!=='open'||channel==='fulfillment')&&<Select key={lineId} name="shortfallId" label="原履约记录" initial={lossId}
        options={Object.fromEntries(view.shortfalls.filter(l=>(!lineId||l.orderItemId===lineId)&&l.quantity>l.claimed).map(l=>[l.resolutionId,l.reference+' · 尚可关联 '+(l.quantity-l.claimed)+' 件']))} onChange={setLoss}/>}
      {action==='open'&&<><Input key={lossId+'-units'} name="quantity" label="涉及数量" type="number" value={loss?loss.quantity-loss.claimed:undefined}/>
        <Input name="relatedCents" label="涉及金额（元，待核可留空）" required={false}/></>}
      {action==='add_evidence'&&<Select name="channel" label="沟通来源" options={{email:'邮件',koncket:'网站客户沟通',handoff:'内部移交'}}/>}
      {action==='technical'&&<><Select name="authority" label="意见来源" options={{supplier:'供应商技术支持',brand:'品牌技术支持'}}/><Input name="party" label="出具意见的单位"/><Input name="contact" label="技术联系人"/></>}
      {action==='agreement'&&<>{revisingReissue?<input type="hidden" name="remedy" value="invoice"/>
        :<Select name="remedy" label="客户同意的处理方式" options={Object.fromEntries(Object.entries(afterSaleRemedies)
          .filter(([key])=>current?.customerState==='refund_followup'?['refund','refund_withdraw'].includes(key):key!=='refund_withdraw'))} onChange={setRemedy}/>}
        <Input name="customerDecision" label="客户确认的条件、范围和费用责任"/>
        {current?.agreementId&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviseAgreement"/>这份较新的决定明确修订当前版本</label>}
        {remedy==='refund'&&<><Input name="refundQuantity" label="本次退款件数" type="number" max={refundQuantity} value={refundQuantity}/>
          <Input name="amountCents" label={current?.customerState==='refund_followup'?'重新约定的未付退款金额（元）':'约定退款金额（元）'}/><Input name="recipient" label="核实的退款收款人"/><Input name="destination" label="收款去向标识"/><Select name="method" label="约定退款渠道" options={methodLabels}/></>}
        {['exchange','return'].includes(remedy)&&!originalShares.length&&Object.keys(originalChoices).length>0&&<Select name="originalParcelLineId" label="客户决定所指的原包裹"
          initial={current?.originalParcelLineId??undefined} options={originalChoices} required={remedy==='exchange'&&!linked}/>}
        {remedy==='exchange'&&!linked&&<Select name="returnRequirement" label="书证约定的退回要求" options={{required:'先核对原件实际退回',waived:'双方书面同意免退换货'}}/>}
        {['resend','exchange'].includes(remedy)&&Object.keys(approved).length>0&&<Select name="resendApprovalId" label="已有补发批准" options={approved} required={false}/>}
        {['resend','exchange'].includes(remedy)&&paidReplacements.length>0&&<fieldset className="space-y-2 sm:col-span-2">
          <legend>已经独立订购的补件份额（如适用）</legend>
          {paidReplacements.map(row=><Input key={row.id} name={'replacement:'+row.purchaseOrderId}
            label={(row.supplier?row.supplier+' · ':'')+row.purchaseOrderId+' · 本案件数，最多 '+row.quantity+' 件'} type="number" required={false}/>)}
        </fieldset>}
        {remedy==='invoice'&&<>{revisingReissue?<><input type="hidden" name="invoiceAllocationId" value={decisionInvoice?.allocationId??''}/>
          <p className="text-sm">原票 {decisionInvoice?.originalNumber} 已红冲，登记客户对待办重开的新决定。</p></>
          :<><Select name="invoiceAllocationId" label="实际受影响的原票分摊" options={invoiceOptions}/>
            <Input name="amountCents" label="书面决定涉及发票金额（元）"/></>}
          <Select name="invoiceOutcome" label="书面决定要求的实际更正结果" options={revisingReissue
            ?{voided:'客户书面撤回重开',reissue:'按新书证调整待重开的金额'}
            :{retained:'书面确认原票继续有效',voided:'只办理原票红冲或作废',reissue:'红冲并实际重开'}} onChange={setOutcome}/>
          {outcome==='reissue'&&<><Input name="replacementAmountCents" label="本商品书面约定的重开金额（元）"/>
            {revisingReissue&&<p className="text-sm">只填尚未签发部分的新金额，已签发的票仍按实际票面办理。</p>}</>}</>}</>}
      {action==='bind_original_parcel'&&<>
        <Select name="parcelLineId" label="本次核对的实际原包裹行" initial={current?.originalParcelLineId??undefined}
          options={Object.fromEntries(actualLines.filter(line=>!line.afterSaleApprovalId&&line.receipts.length
            && (!current?.originalParcelLineId||current.originalParcelLineId===line.id)).map(line=>[line.id,originalChoices[line.id]]))}/>
        {current?.originalParcelLineId&&<p className="text-sm">原案已指定此包裹。请凭实际签收和分份书证核对本案件数。</p>}
        <Input name="quantity" label="本案在该包裹中的实际件数" type="number"/>
      </>}
      {action==='physical'&&<><Select name="result" label="实物结果" options={physicalLabels} required={false} onChange={setPhysical}/>
        {physical&&<><Select key={physical} name="parcelLineId" label="对客包裹明细" options={Object.fromEntries((physical==='return'?originalOnly:actualLines)
          .map(l=>[l.id,l.reference+' · '+l.quantity+' 件']))} onChange={setParcel}/>
          <Input name="quantity" label="本次核对件数" type="number"/>
          {physical==='return'&&<Select name="resolutionId" label="已登记的退回" options={Object.fromEntries((selectedParcel?.returns??[]).map(a=>[a.id,a.id+' · '+a.quantity+' 件']))}/>}
          {physical==='delivery'&&Object.keys(approved).length>0&&<Select name="resendApprovalId" label="原采购补发批准" options={approved} required={false}/>}</>}</>}
      {action==='approve_exchange'&&<><Select name="parcelLineId" label="本次换件对应的原包裹" options={assigned}
        initial={Object.keys(assigned).length===1?Object.keys(assigned)[0]:undefined} onChange={setParcel}/>
        <Input name="quantity" label="本次批准的件数" type="number" value={originalShares.length===1?originalShares[0].quantity:undefined}/>
        <Input name="supplier" label="原采购记录所列供货主体"/>
        <Select name="returnRequirement" label="供方书面承诺中的退回条件" options={{required:'原货实际退回',waived:'确认对本批货免退'}}/>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="freeOfCharge" required/>确认原供方书面承诺本批换货免费</label>
        {documentParcels.length>1&&<fieldset className="grid gap-2 sm:col-span-2">
          <legend className="text-sm font-medium">同一书证行列出的案件、原包裹和件数</legend>
          <p className="text-sm">若这一行明确覆盖多个案件或包裹，按原件填写每份件数，再逐份批准。</p>
          {documentParcels.map(part=><Input key={part.key} name={'exchangeDocument:'+part.key} label={part.label+' · 书证列明件数'}
            type="number" max={part.count} required={false}/>)}
        </fieldset>}</>}
      {action==='attribute_resend'&&<><Select name="parcelLineId" label="实际补件对客包裹" options={Object.fromEntries(actualLines
        .filter(l=>l.attributionRequired&&linked?.approved.some(a=>a.id===l.approvalId)).map(l=>[l.id,l.reference+' · '+l.quantity+' 件']))} onChange={setParcel}/>
        <Input name="quantity" label="本书证证明对应本案的件数" type="number"/></>}
      {action==='supplier'&&<><Select name="outcome" label="供应商侧结果" options={{following:'继续跟进',no_claim:'经核实无需追偿',resolved:'已有书面处理结果',financial_result:'核实了实际退款或抵扣'}} onChange={setOutcome}/>
        {current?.supplierScopes?.length?<><Select name="supplierScope" label="本次处理的供方和采购份额" initial={supplierScope}
          options={Object.fromEntries(current.supplierScopes.map(part=>[part.key,
            (part.supplier?part.supplier+' · ':'')+part.purchaseOrderId+' · '+(part.reference?part.reference+' · ':'')+part.quantity+' 件']))}
          onChange={setSupplierScope}/><Input key={supplierScope} name="supplier" label="供应商主体" value={selectedScope?.supplier??undefined}/></>
          :<><Input name="purchaseOrderId" label="对应采购单号" required={outcome!=='no_claim'} value={linked?.purchaseOrderId
            ??originalOnly.find(row=>row.id===current?.originalParcelLineId)?.purchaseOrderId??undefined}/>
            <Input name="supplier" label="供应商主体" required={outcome!=='no_claim'}/>
            {!linked&&!current?.originalParcelLineId&&Object.keys(originalChoices).length>0&&<Select name="originalParcelLineId"
              label="本案实际对应的供方原包裹" options={originalShares.length?assigned:originalChoices} required={false}/>}</>}
        {outcome==='financial_result'&&<><Input name="amountCents" label="供应商实际处理金额（元）"/><Input name="method" label="供方处理方式"/><Input name="referenceNo" label="供方回执流水"/><Input name="destination" label="实际收款去向或抵扣出处"/>
          <Input name="transferTotalCents" label="同笔真实交易总额（元，全部归本行可留空）" required={false}/>
          <Input name="allocationReference" label="本行分摊依据（分摊时填写）" required={false}/></>}</>}
      {action==='invoice_outcome'&&(receipt?<p>实际更正回执 {receipt.reference} · 办理订单 {receipt.orderId} · 记录 {receipt.id}</p>
        :<Input name="financeEventId" label="已办完的票据更正记录号"/>)}
      {action==='verify_invoice_line'&&<>
        {current?.customerState==='awaiting_invoice_reissue'&&<label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={reviewReissueLink} onChange={event=>setReviewReissueLink(event.target.checked)}/>
          凭补充原件核对前序红冲和本商品承接份额
        </label>}
        <Select name="invoiceAllocationId" label="须凭原件核对的发票分摊" options={invoiceOptions}
          onChange={id=>{setSelectedInvoice(id);setPredecessorId('');}}/>
        <Input name="amountCents" label={reviewReissueLink?'本商品从前序红冲承接的实际金额（元）':'这张票归入本商品的全部金额（元）'}/>
        {reviewReissueLink&&<>
          <Select name="reissueScope" label="这份金额实际所属的开票安排" initial="this_case"
            options={{this_case:'本案书面约定的重开',other_plan:'另一个实际开票安排'}}/>
          <Select key={selectedInvoice} name="reissueParentAllocationId" label="前序红冲票的实际分摊"
            options={Object.fromEntries(predecessors.map(row=>[row.id,invoiceOptions[row.id]]))} onChange={setPredecessorId}/>
          {predecessor?.correction&&<><input type="hidden" name="sourceCorrectionEventId" value={predecessor.correction.id}/>
            <p className="text-sm">正式红冲回执 {predecessor.correction.reference} · {predecessor.correction.id}</p></>}
          <p className="text-sm sm:col-span-2">同一后继票承接多份前序分摊时，按原件逐份核对，每次只填写这份分摊的金额。</p>
        </>}
        {!reviewReissueLink&&selectedPortions.length>0&&<fieldset key={selectedInvoice} className="grid gap-2 sm:col-span-2">
          <legend className="text-sm font-medium">覆盖本商品的共同书证</legend>
          {selectedPortions.length>1&&<p className="text-sm">分别填写原件确实归给本商品的分项金额，未使用的书证留空。</p>}
          {selectedPortions.map(part=>{
            const label=(part.reference??part.invoiceScopeId)+(part.documentRow?' · 第 '+part.documentRow+' 行':'')
              +' · '+part.lines.map(goods=>view.lines.find(line=>line.id===goods.orderItemId)?.name??goods.orderItemId)
              .join('、')+' · 原件分摊 '+money(part.amountCents);
            return selectedPortions.length>1?<Input key={part.invoiceScopeId} name={'invoicePortion:'+part.invoiceScopeId}
              label={label+' · 本商品金额（元）'} required={false}/>:<p className="text-sm" key={part.invoiceScopeId}>{label}</p>;
          })}
        </fieldset>}</>}
      {action==='invoice_reissue'&&<>
        <Select name="invoiceAllocationId" label="财务已实际登记的替代票分摊" options={invoiceOptions}/>
        <Input name="amountCents" label="本票实际归入本案的金额（元）"/>
        {reissueRemaining!=null&&<p className="text-sm">本案尚待核对 {money(reissueRemaining)}，多张实际票可以逐张回填。</p>}
        <p className="text-sm">原红冲回执 {String(currentCorrection?.operation?.financeEventId??'')}</p>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input name="confirmReplacementEvidence" type="checkbox"/>
          若开票时未关联原红冲，凭补充书证核实原票、红冲回执及替代票的对应关系</label>
        <Input name="financeEventId" label="补核后继票时填写直接对应的红冲回执记录号" required={false}/></>}
      {action==='release_refund_source'&&<label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input name="confirmUnsent" type="checkbox" required/>核实这笔款未获退款批准、未发出指令，且客户后来书面要求保留原单
      </label>}
      {action==='review_refund_source'&&<>
        <Select name="paymentId" label="可核实的原平台到账" options={Object.fromEntries((view.refundSources??[])
          .map(row=>[row.id,row.tradeNo+' · '+money(row.amountCents)+' · '+new Date(row.arrivedAt).toLocaleString('zh-CN')]))} onChange={setSelectedPayment}/>
        {payment&&<><input type="hidden" name="originalTradeNo" value={payment.tradeNo}/><input type="hidden" name="customerKey" value={payment.customerKey??''}/>
          <p className="text-sm">按原件核对本单付款主体和实际原交易 {payment.tradeNo}，并填写核对结论。</p></>}</>}
      {action==='stop_refund'&&<>
        <Select name="result" label="渠道书面确认的终止结果" options={{failed:'渠道确认未付且指令终止',stopped:'渠道确认已撤销指令'}}/>
        <Input name="referenceNo" label="原渠道退款指令或终止书面编号"/>
        <label className="flex items-center gap-2 text-sm"><input name="confirmStopped" type="checkbox" required/>凭原件确认整笔未退余额所对应的原渠道指令已终止</label>
        {pendingInstructions.map(entry=><label key={entry.id} className="flex items-center gap-2 text-sm"><input name="pendingResultIds" type="checkbox" value={entry.id} required/>
          确认未决指令 {String(entry.operation?.referenceNo)} 已终止</label>)}</>}
      {action==='prepare_refund'&&<Input name="historyReview" label="既有退款、积分及外部回执的核对记录"/>}
      {action==='refund_result'&&<><Select name="result" label="实际退款结果" options={{pending:'渠道处理中',failed:'渠道确认未付',paid:'取得实际退款凭据'}} onChange={setRefundResult}/>
        <Input name="referenceNo" label="银行或支付渠道的回执流水"/>{refundResult==='paid'&&<><Input name="amountCents" label="本次实际退款金额（元）"/>
          <Input name="transferTotalCents" label="同笔真实转账总额（元，全部归本行可留空）" required={false}/>
          <Input name="allocationReference" label="本行分摊依据（分摊时填写）" required={false}/></>}
        <Input name="recipient" label="回执所列收款人"/><Input name="destination" label="回执所列去向标识"/><Select name="method" label="实际渠道" options={methodLabels}/></>}
    </div>
    {draft && ['prepare_refund','approve_refund','refund_result','stop_refund'].includes(action)&&<section className="rounded bg-slate-50 p-3 text-sm">
      <h4 className="font-medium">原退款条件与票款记录</h4><p>客户同意 {money(draft.terms.amountCents)}，收款人 {draft.terms.recipient} · {draft.terms.destination}</p>
      <p>{draft.position.independentReceipt?'已核实独立交易到账':'已核实订单实收'} {money(draft.position.paidCents)}，其他售后占用 {money(draft.position.usedCents)}，本案已实际退款 {money(draft.position.recordedCents)}</p></section>}
    <label className="grid gap-1 text-sm">{action==='open'?'实际问题和客户要求':'办理说明'}<textarea className={field} name="note" rows={2} maxLength={2000} required/></label>
    {original?<p className="break-all rounded bg-slate-50 p-2 text-sm">原履约凭据 {original.reference} · 第 {original.documentRow} 行 · {original.occurredAt}<br/>{original.sha256}</p>
      :receipt?<p className="break-all rounded bg-slate-50 p-2 text-sm">原票回执 {receipt.reference} · {new Date(receipt.occurredAt).toLocaleString('zh-CN')}<br/>{receipt.sha256}</p>
      :<div className="grid gap-3 sm:grid-cols-2"><Input name="occurredAt" label="凭据实际发生时间" type="datetime-local"/><Input name="reference" label="凭据名称或档案出处"/>
        <Input name="documentRow" label="凭据行号" type="number" value={1}/><DocumentDigestField name="sha256" label="原件 SHA-256" required/></div>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-2"><button className={primary} disabled={busy}>预览本次内容</button><button type="button" className={button} onClick={onCancel}>返回</button></div>
  </form>;
}

export function issueName(value:string) {return hasChoice(afterSaleIssues,value)?afterSaleIssues[value]:value;}
