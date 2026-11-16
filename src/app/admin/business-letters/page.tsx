import BusinessLettersManager from '@/components/admin/BusinessLettersManager';

export default async function BusinessLettersPage({ searchParams }: {
  searchParams: Promise<{ reviewId?: string | string[]; reference?: string | string[] }>;
}) {
  const params = await searchParams;
  const reviewId = typeof params.reviewId === 'string' ? params.reviewId : '';
  const reference = typeof params.reference === 'string' ? params.reference : '';
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-bold">商务信函</h1>
      <p className="mt-2 text-sm text-gray-500">维护常用信函，填写业务内容，预览后确认发送。人工与自动流程使用同一套模板。</p></header>
    <BusinessLettersManager key={`${reviewId}:${reference}`} initialReviewId={reviewId} initialReference={reference} />
  </div>;
}
