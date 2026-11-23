'use client';

import { useState, type FormEvent } from 'react';
import DocumentDigestField from '@/components/admin/purchases/DocumentDigestField';
import { button, field, primary, money } from '@/components/admin/purchases/PurchaseLineForm';
import { afterSaleActions, afterSaleChannels, afterSaleIssues, afterSaleRemedies, hasChoice, type AfterSaleAction } from '@/lib/after-sale-options';
import type { afterSaleAdminView } from '@/lib/after-sale-workspace';
import type { refundTerms, refundPosition } from '@/lib/after-sale-refunds';

export type Desk = ReturnType<typeof afterSaleAdminView> & { refundDrafts: Array<{caseId:string;terms:ReturnType<typeof refundTerms>;position:Awaited<ReturnType<typeof refundPosition>>}> };
type Case = Desk['cases'][number];
export type FormInput = { orderId:string;caseId?:string;action:AfterSaleAction;requestId:string;data:Record<string,unknown> };
const shortfallActions: AfterSaleAction[]=['link_shortfall','open'];
const inYuan=(s: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw Error('请填写最多两位小数的人民币金额');
  const [i,f='']=s.split('.');const result=Number(i)*100+Number(f.padEnd(2,'0'));
  if (!Number.isSafeInteger(result)) throw Error('请核对人民币金额');
  return result;
};
function Input({name,label,required=true,type='text',value}: {name:string;label:string;required?:boolean;type?:string;value?:string|number}) {
  return <label className="grid gap-1 text-sm">{label}<input className={field} name={name} type={type} required={required} defaultValue={value}
    min={type==='number'?1:undefined} step={type==='number'?1:type==='datetime-local'?'0.001':undefined} maxLength={type==='text'?2000:undefined}/></label>;
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
  const [remedy,setRemedy]=useState('');const [outcome,setOutcome]=useState('');const [error,setError]=useState('');
  const [physical,setPhysical]=useState('');const [parcelId,setParcel]=useState('');
  const [channel,setChannel]=useState(chosenLoss?'fulfillment':'');const [refundResult,setRefundResult]=useState('');
  const loss=view.shortfalls.find(row=>row.resolutionId===lossId);
  const linked=view.shortfalls.find(row=>row.resolutionId===(current?.shortfallId??lossId));
  const draft=view.refundDrafts.find(row=>row.caseId===current?.id);
  const original=action==='link_shortfall'||(action==='open'&&channel==='fulfillment') ? loss : null;
  const actualLines=view.deliveries.filter(l=>l.orderItemId===lineId && l.route!=='supplier_to_libereal');
  const selectedParcel=actualLines.find(l=>l.id===parcelId);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError('');
    try {
      const record=Object.fromEntries(new FormData(event.currentTarget).entries());
      const data:Record<string,unknown>={};
      for(const [k,v] of Object.entries(record)) if(typeof v==='string'&&v.trim()) data[k]=v.trim();
      for(const key of ['quantity','documentRow']) if(data[key]!=null) data[key]=Number(data[key]);
      for(const key of ['relatedCents','amountCents']) if(typeof data[key]==='string') data[key]=inYuan(data[key]);
      if(original) Object.assign(data,{occurredAt:original.occurredAt,reference:original.reference,sha256:original.sha256,documentRow:original.documentRow});
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
        {channel!=='fulfillment'&&<Select name="issue" label="问题类别" options={afterSaleIssues}/>}</>}
      {shortfallActions.includes(action)&&(action!=='open'||channel==='fulfillment')&&<Select key={lineId} name="shortfallId" label="原履约记录" initial={lossId}
        options={Object.fromEntries(view.shortfalls.filter(l=>(!lineId||l.orderItemId===lineId)&&l.quantity>l.claimed).map(l=>[l.resolutionId,l.reference+' · 尚可关联 '+(l.quantity-l.claimed)+' 件']))} onChange={setLoss}/>}
      {action==='open'&&<><Input key={lossId+'-units'} name="quantity" label="涉及数量" type="number" value={loss?loss.quantity-loss.claimed:undefined}/>
        <Input name="relatedCents" label="涉及金额（元，待核可留空）" required={false}/></>}
      {action==='add_evidence'&&<Select name="channel" label="沟通来源" options={{email:'邮件',koncket:'网站客户沟通',handoff:'内部移交'}}/>}
      {action==='technical'&&<><Select name="authority" label="意见来源" options={{supplier:'供应商技术支持',brand:'品牌技术支持'}}/><Input name="party" label="出具意见的单位"/><Input name="contact" label="技术联系人"/></>}
      {action==='agreement'&&<><Select name="remedy" label="客户同意的处理方式" options={afterSaleRemedies} onChange={setRemedy}/><Input name="customerDecision" label="客户确认的条件、范围和费用责任"/>
        {remedy==='refund'&&<><Input name="amountCents" label="约定退款金额（元）"/><Input name="recipient" label="核实的退款收款人"/><Input name="destination" label="收款去向标识"/><Select name="method" label="约定退款渠道" options={methodLabels}/></>}
        {['resend','exchange'].includes(remedy)&&Object.keys(approved).length>0&&<Select name="resendApprovalId" label="已有补发批准" options={approved} required={false}/>}</>}
      {action==='physical'&&<><Select name="result" label="实物结果" options={physicalLabels} required={false} onChange={setPhysical}/>
        {physical&&<><Select name="parcelLineId" label="对客包裹明细" options={Object.fromEntries(actualLines.map(l=>[l.id,l.reference+' · '+l.quantity+' 件']))} onChange={setParcel}/>
          <Input name="quantity" label="本次核对件数" type="number"/>
          {physical==='return'&&<Select name="resolutionId" label="已登记的退回" options={Object.fromEntries((selectedParcel?.returns??[]).map(a=>[a.id,a.id+' · '+a.quantity+' 件']))}/>}
          {physical==='delivery'&&Object.keys(approved).length>0&&<Select name="resendApprovalId" label="原采购补发批准" options={approved}/>}</>}</>}
      {action==='supplier'&&<><Select name="outcome" label="供应商侧结果" options={{following:'继续跟进',no_claim:'经核实无需追偿',resolved:'已有书面处理结果',financial_result:'核实了实际退款或抵扣'}} onChange={setOutcome}/>
        <Input name="purchaseOrderId" label="对应采购单号" required={outcome!=='no_claim'} value={linked?.purchaseOrderId}/><Input name="supplier" label="供应商主体" required={outcome!=='no_claim'}/>
        {outcome==='financial_result'&&<><Input name="amountCents" label="供应商实际处理金额（元）"/><Input name="method" label="供方处理方式"/><Input name="referenceNo" label="供方回执流水"/></>}</>}
      {action==='invoice_outcome'&&<Input name="financeEventId" label="已办完的票据更正记录号"/>}
      {action==='prepare_refund'&&<Input name="historyReview" label="既有退款、积分及外部回执的核对记录"/>}
      {action==='refund_result'&&<><Select name="result" label="实际退款结果" options={{pending:'渠道处理中',failed:'渠道确认未付',paid:'取得实际退款凭据'}} onChange={setRefundResult}/>
        <Input name="referenceNo" label="银行或支付渠道的回执流水"/>{refundResult==='paid'&&<Input name="amountCents" label="本次实际退款金额（元）"/>}
        <Input name="recipient" label="回执所列收款人"/><Input name="destination" label="回执所列去向标识"/><Select name="method" label="实际渠道" options={methodLabels}/></>}
    </div>
    {draft && ['prepare_refund','approve_refund','refund_result'].includes(action)&&<section className="rounded bg-slate-50 p-3 text-sm">
      <h4 className="font-medium">原退款条件与票款记录</h4><p>客户同意 {money(draft.terms.amountCents)}，收款人 {draft.terms.recipient} · {draft.terms.destination}</p>
      <p>已核实订单实收 {money(draft.position.paidCents)}，其他售后占用 {money(draft.position.usedCents)}，本案已实际退款 {money(draft.position.recordedCents)}</p></section>}
    <label className="grid gap-1 text-sm">{action==='open'?'实际问题和客户要求':'办理说明'}<textarea className={field} name="note" rows={2} maxLength={2000} required/></label>
    {original?<p className="break-all rounded bg-slate-50 p-2 text-sm">原履约凭据 {original.reference} · 第 {original.documentRow} 行 · {original.occurredAt}<br/>{original.sha256}</p>
      :<div className="grid gap-3 sm:grid-cols-2"><Input name="occurredAt" label="凭据实际发生时间" type="datetime-local"/><Input name="reference" label="凭据名称或档案出处"/>
        <Input name="documentRow" label="凭据行号" type="number" value={1}/><DocumentDigestField name="sha256" label="原件 SHA-256" required/></div>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-2"><button className={primary} disabled={busy}>预览本次内容</button><button type="button" className={button} onClick={onCancel}>返回</button></div>
  </form>;
}

export function issueName(value:string) {return hasChoice(afterSaleIssues,value)?afterSaleIssues[value]:value;}
