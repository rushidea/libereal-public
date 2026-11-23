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
