'use client';

import AdaptiveHeader from '@/components/AdaptiveHeader';
import AdminShell from '@/components/admin/AdminShell';

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader isAdmin />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-1 lg:pb-6">
        <AdminShell>{children}</AdminShell>
      </main>
    </div>
  );
}
