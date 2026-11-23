import FinanceManager from '@/components/admin/finance/FinanceManager';

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ orderId?: string | string[] }> }) {
  const { orderId } = await searchParams;
  return <FinanceManager initialOrder={typeof orderId === 'string' ? orderId : ''}/>;
}
