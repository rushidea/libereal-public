import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AfterSalesManager from '@/components/admin/after-sales/AfterSalesManager';
import OrderAfterSales from '@/components/account/OrderAfterSales';

vi.mock('@/components/admin/AdminMfaStepUpDialog',()=>({useAdminMfaStepUp:()=>({begin:vi.fn(),dialog:null})}));
const res=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}));
const order='OFFICE-CUSTOMER-17';
const line={id:'office-folder',name:'文件夹',quantity:2,unitPrice:100};
const hash='b'.repeat(64);
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});

describe('客户与经办人从原订单进入售后',()=>{
  it('沿原履约凭据显示待办，可用的旧批准直接带回预览',async()=>{
    const scope={order:{id:order,status:'confirmed',acceptedAt:'2026-11-01T01:00:00Z'},lines:[line],deliveries:[],cases:[],refundDrafts:[],
      shortfalls:[{resolutionId:'LOSS-1',orderItemId:line.id,purchaseOrderId:'PO-1',quantity:1,claimed:0,reference:'少件原件',
        occurredAt:'2026-11-02T01:01:01.123Z',sha256:hash,documentRow:4,approved:[{id:'RESEND-1',quantity:1,available:1,dispatched:0,customerReceived:0}]}]};
    let sent:Record<string,unknown>|null=null;
    vi.stubGlobal('fetch',vi.fn((input:string,init?:RequestInit)=>{
      if(init?.method==='POST'){
        const request=JSON.parse(String(init.body));sent=request;
        return res({preview:{actionHash:hash,snapshot:{item:line,scopeQuantity:1,nextState:'reported',nextSupplierState:'unreviewed',proof:{reference:'少件原件'},operation:{quantity:1}}}});
      }
      return res({workspace:scope,permissions:['admin.access','orders.read','orders.write']});
    }));
    render(<AfterSalesManager initialOrder={order}/>);
    await screen.findByText(/原补发批准 RESEND-1/);
    fireEvent.click(screen.getByRole('button',{name:'接续这条履约记录'}));
    fireEvent.change(screen.getByLabelText('实际问题和客户要求'),{target:{value:'沿原少件单核对一件文件夹'}});
    fireEvent.click(screen.getByRole('button',{name:'预览本次内容'}));
    const preview=await screen.findByRole('region',{name:'售后办理预览'});
    expect(within(preview).getByText(/文件夹 × 1/)).toBeTruthy();
    expect(sent).toMatchObject({stage:'preview',orderId:order,action:'open',data:{shortfallId:'LOSS-1',orderItemId:line.id,quantity:1,documentRow:4,
      occurredAt:scope.shortfalls[0].occurredAt,reference:'少件原件',sha256:hash,issue:'shortage',channel:'fulfillment'}});
    expect(within(preview).getByRole('button',{name:'确认登记售后'})).toBeTruthy();
  });
  it('第二张订单直接使用第一张办理的整票红冲回执，重开另选实际发票',async()=>{
    const receipt={id:'CORRECTION-FROM-A',orderId:'OFFICE-ORDER-A',outcome:'voided',reference:'跨单整票红冲原件',sha256:hash,
      occurredAt:'2026-11-02T01:01:01.123Z'};
    const original={id:'PART-B-ORIGINAL',invoiceId:'SHARED-OLD',number:'整票原号',issuer:'办公开票方',amountCents:4000,
      issuedAt:'2026-11-01T01:01:01Z',correction:receipt};
    const replacement={...original,id:'PART-B-REISSUE',invoiceId:'NEW',number:'实际重开票号',correction:null};
    const agreement={id:'AGREED',action:'agreement',actorId:'clerk',occurredAt:'2026-11-01T03:00:00Z',operation:{
      remedy:'invoice',invoice:{allocationId:original.id,invoiceId:original.invoiceId,expectedOutcome:'reissue',replacementAmountCents:4000}}};
    const corrected={...agreement,id:'LINKED',action:'invoice_outcome',operation:{agreementId:agreement.id,financeEventId:receipt.id,allocationId:original.id}};
    const sale={id:'B-SALE-CASE',orderItemId:line.id,quantity:1,issue:'invoice',ownerId:'finance',customerState:'awaiting_invoice',supplierState:'unreviewed',
      report:'客户要求红冲并重开',reference:'原售后请求',reportedAt:'2026-11-01T02:00:00Z',agreementId:agreement.id,events:[agreement]};
    const suppliers=[{key:'primary',purchaseOrderId:'PO-A',supplier:'办公供方甲',parcelLineId:'P-A',quantity:1,
      reference:'甲实际运单',state:'resolved',ownerId:'首位经办',lastReference:'甲书面结案'},
      {key:'other',purchaseOrderId:'PO-B',supplier:'办公供方乙',parcelLineId:'P-B',quantity:1,
      reference:'乙实际运单',state:'following',ownerId:'另一位经办',lastReference:'乙书面仍待办'}];
    Object.assign(sale,{supplierScopes:suppliers});
    const desk={order:{id:order,status:'confirmed',acceptedAt:'2026-11-01T01:00:00Z'},lines:[line],shortfalls:[],deliveries:[],
      cases:[sale],refundDrafts:[],invoiceChoices:[original,replacement]};
    const submissions:unknown[]=[];
    vi.stubGlobal('fetch',vi.fn((_input:string,init?:RequestInit)=>{
      if(init?.method==='POST'){
        submissions.push(JSON.parse(String(init.body)));
        return res({preview:{actionHash:hash,snapshot:{item:line,scopeQuantity:1,nextState:'awaiting_invoice_reissue',nextSupplierState:'unreviewed',
          proof:{reference:receipt.reference},operation:{financeEventId:receipt.id}}}});
      }
      return res({workspace:desk,permissions:['admin.access','finance.read','finance.write','orders.read','orders.write']});
    }));
    render(<AfterSalesManager initialOrder={order}/>);
    expect(await screen.findByText(/办公供方甲.*已独立办结.*首位经办/)).toBeTruthy();
    expect(screen.getByText(/办公供方乙.*跟进中.*另一位经办/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button',{name:'回填发票处理结果'}));
    expect(screen.getByText(/办理订单 OFFICE-ORDER-A/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('办理说明'),{target:{value:'本单实际分摊与整票红冲一致'}});
    fireEvent.click(screen.getByRole('button',{name:'预览本次内容'}));
    await screen.findByRole('region',{name:'售后办理预览'});
    expect(submissions[0]).toMatchObject({orderId:order,caseId:sale.id,action:'invoice_outcome',
      data:{financeEventId:receipt.id,sha256:receipt.sha256,reference:receipt.reference,occurredAt:receipt.occurredAt}});
    Object.assign(sale,{customerState:'awaiting_invoice_reissue',events:[agreement,corrected]});
    fireEvent.click(screen.getByRole('button',{name:'刷新本单'}));
    fireEvent.click(await screen.findByRole('button',{name:'关联已实际重开的替代发票'}));
    const picker=screen.getByLabelText('财务已实际登记的替代票分摊');
    expect(within(picker).queryByRole('option',{name:/整票原号/})).toBeNull();
    expect(within(picker).getByRole('option',{name:/实际重开票号/})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'返回'}));
    fireEvent.click(screen.getByRole('button',{name:'登记客户书面决定'}));
    expect(screen.getByText(/登记客户对待办重开的新决定/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('书面决定要求的实际更正结果'),{target:{value:'reissue'}});
    fireEvent.change(screen.getByLabelText('本商品书面约定的重开金额（元）'),{target:{value:'60'}});
    fireEvent.click(screen.getByLabelText('这份较新的决定明确修订当前版本'));
    fireEvent.change(screen.getByLabelText('客户确认的条件、范围和费用责任'),{target:{value:'新的真实书面条件仅调整重开金额'}});
    fireEvent.change(screen.getByLabelText('办理说明'),{target:{value:'沿同一原票红冲回执继续'}});
    fireEvent.change(screen.getByLabelText('凭据实际发生时间'),{target:{value:'2026-11-06T10:00'}});
    fireEvent.change(screen.getByLabelText('凭据名称或档案出处'),{target:{value:'客户新书面决定原件'}});
    fireEvent.change(screen.getByLabelText('原件 SHA-256',{exact:true}),{target:{value:hash}});
    fireEvent.click(screen.getByRole('button',{name:'预览本次内容'}));
    await waitFor(()=>expect(submissions).toHaveLength(2));
    expect(submissions[1]).toMatchObject({action:'agreement',caseId:sale.id,data:{remedy:'invoice',invoiceAllocationId:original.id,
      invoiceOutcome:'reissue',replacementAmountCents:6000,revisesAgreementId:agreement.id}});
    expect(submissions[1]).not.toHaveProperty('data.amountCents');
  });

  it('订单岗确认前显示本人这次录入的退款三项，既有财务历史只显示事项',async()=>{
    const sale={id:'new-own-terms',orderItemId:line.id,quantity:1,issue:'other',ownerId:'order-clerk',customerState:'reviewing',
      supplierState:'unreviewed',report:'合成办公用品售后',reference:'本案原件',reportedAt:'2026-11-01T02:00:00Z',
      events:[{id:'prior-finance',action:'refund_result',actorId:'finance',occurredAt:'2026-11-01T01:00:00Z',reference:null,operation:null}]};
    const workspace={order:{id:order,status:'confirmed',acceptedAt:'2026-11-01T01:00:00Z'},lines:[line],shortfalls:[],deliveries:[],
      cases:[sale],refundDrafts:[],invoiceChoices:[]};
    let submitted:unknown;
    vi.stubGlobal('fetch',vi.fn((_input:string,init?:RequestInit)=>{
      if(init?.method==='POST'){
        const request=JSON.parse(String(init.body));submitted=request;
        const {amountCents,recipient,destination,method}=request.data;
        return res({preview:{actionHash:hash,snapshot:{item:line,scopeQuantity:1,nextState:'awaiting_refund',nextSupplierState:'unreviewed',
          proof:{reference:request.data.reference},operation:{amountCents,recipient,destination,method,remedy:'refund'}}}});
      }
      return res({workspace,permissions:['admin.access','orders.read','orders.write']});
    }));
    render(<AfterSalesManager initialOrder={order}/>);
    fireEvent.click(await screen.findByRole('button',{name:'登记客户书面决定'}));
    fireEvent.change(screen.getByLabelText('客户同意的处理方式'),{target:{value:'refund'}});
    for(const [label,value] of [
      ['客户确认的条件、范围和费用责任','仅记录本人收到的客户决定'],['约定退款金额（元）','100'],
      ['核实的退款收款人','本次输入的合成收款人'],['收款去向标识','本次输入的合成去向'],['约定退款渠道','alipay'],
      ['办理说明','凭实际客户书证登记'],['凭据实际发生时间','2026-11-09T10:00'],['凭据名称或档案出处','本次客户原件'],
      ['原件 SHA-256',hash],
    ]) fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
    fireEvent.click(screen.getByRole('button',{name:'预览本次内容'}));
    const confirmation=await screen.findByRole('region',{name:'售后办理预览'});
    expect(within(confirmation).getByText('本次输入的合成收款人',{exact:true})).toBeTruthy();
    expect(within(confirmation).getByText('本次输入的合成去向',{exact:true})).toBeTruthy();
    expect(within(confirmation).getByText(/￥?¥?100[.]00/)).toBeTruthy();
    expect(submitted).toMatchObject({action:'agreement',data:{amountCents:10000,recipient:'本次输入的合成收款人',destination:'本次输入的合成去向'}});
  });

  it('客户重复提交同一内容时沿用原申请编号，回到自己的订单状态',async()=>{
    const attempts:Array<Record<string,unknown>>=[];let saved=false;
    vi.stubGlobal('fetch',vi.fn((_input:string,init?:RequestInit)=>{
      if(init?.method==='POST'){
        attempts.push(JSON.parse(String(init.body)));
        if(!saved){saved=true;return res({error:'请从原单重试'},503);}
        return res({id:'CASE-OFFICE',repeated:true});
      }
      return res({cases:attempts.length>1?[{id:'CASE-OFFICE',orderItemId:line.id,quantity:1,issue:'shortage',customerState:'reviewing'}]:[]});
    }));
    render(<OrderAfterSales orderId={order} items={[line]}/>);
    fireEvent.click(screen.getByRole('button',{name:'提交售后需求'}));
    fireEvent.change(screen.getByLabelText('问题类别'),{target:{value:'shortage'}});
    fireEvent.change(screen.getByLabelText('涉及数量'),{target:{value:'1'}});
    fireEvent.change(screen.getByLabelText('发生了什么，希望怎样处理？'),{target:{value:'到货少一本文件夹，请核对'}});
    fireEvent.click(screen.getByRole('button',{name:'提交需求'}));
    await screen.findByText('请从原单重试');fireEvent.click(screen.getByRole('button',{name:'提交需求'}));
    await screen.findByText(/文件夹 × 1 · 少发或遗失 · 经办人跟进中/);
    await waitFor(()=>expect(attempts).toHaveLength(2));expect(attempts[1]).toEqual(attempts[0]);
  });
});
