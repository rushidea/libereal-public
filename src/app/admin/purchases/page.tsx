import PurchaseManager from '@/components/admin/purchases/PurchaseManager';

export default async function PurchasesPage({searchParams}:{searchParams:Promise<{orderId?:string|string[]}>}) {
  const {orderId}=await searchParams;
  return <PurchaseManager initialOrder={typeof orderId==='string'?orderId:''}/>;
}
