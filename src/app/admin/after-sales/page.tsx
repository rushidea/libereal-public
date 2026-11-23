import AfterSalesManager from '@/components/admin/after-sales/AfterSalesManager';

export default async function AfterSalesPage({searchParams}:{searchParams:Promise<{orderId?:string|string[];shortfallId?:string|string[]}>}) {
  const {orderId,shortfallId}=await searchParams;
  return <AfterSalesManager initialOrder={typeof orderId==='string'?orderId:''} initialLoss={typeof shortfallId==='string'?shortfallId:''}/>;
}
