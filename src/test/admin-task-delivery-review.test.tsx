import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DeliveryReview from '@/app/admin/tasks/DeliveryReview';

afterEach(()=>{
  cleanup();
  vi.unstubAllGlobals();
});

it('sends a partial review with the displayed version and the selected original target only',async()=>{
  const version='a'.repeat(64);
  const first='b'.repeat(64);
  const second='c'.repeat(64);
  const reload=vi.fn(async()=>{});
  const fetchReview=vi.fn(async()=>Response.json({status:'awaiting_human'}));
  vi.stubGlobal('fetch',fetchReview);
  render(<DeliveryReview id="sample-task" version={version} reload={reload}
    scope={{kind:'credit_reminder',reference:'合成原应收记录',sourceVersion:null,targets:[
      {id:first,channel:'email',recipient:'buyer@example.test'},{id:second,channel:'sms',recipient:'+86123456'},
    ]}}/>);
  fireEvent.click(screen.getByText('登记投递核查'));
  expect(screen.getByText('原业务记录 合成原应收记录')).toBeVisible();
  fireEvent.change(screen.getByLabelText('核查结果'),{target:{value:'partial'}});
  const confirm=screen.getByRole('button',{name:'确认登记核查结果'});
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox',{name:'短信 · +86123456'}));
  fireEvent.change(screen.getByLabelText('回执编号或书证位置'),{target:{value:'合成短信回执档案'}});
  fireEvent.change(screen.getByLabelText('书证 SHA-256',{exact:true}),{target:{value:'D'.repeat(64)}});
  fireEvent.click(confirm);
  await waitFor(()=>expect(reload).toHaveBeenCalledTimes(1));
  expect(fetchReview).toHaveBeenCalledTimes(1);
  expect(fetchReview).toHaveBeenCalledWith('/api/admin/tasks',expect.objectContaining({
    method:'PATCH',body:JSON.stringify({id:'sample-task',action:'record_delivery_review',version,outcome:'partial',
      reference:'合成短信回执档案',sha256:'d'.repeat(64),targetIds:[second]}),
  }));
});
