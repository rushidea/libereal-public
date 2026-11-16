import BusinessLettersManager from '@/components/admin/BusinessLettersManager';

export default function BusinessLettersPage() {
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-bold">商务信函</h1>
      <p className="mt-2 text-sm text-gray-500">维护常用信函，填写业务内容，预览后确认发送。人工与自动流程使用同一套模板。</p></header>
    <BusinessLettersManager />
  </div>;
}
