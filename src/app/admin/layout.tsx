import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canViewAdminPages } from '@/lib/admin-page-access';
import { privatePageMetadata } from '@/lib/seo/robots';
import AdminLayoutClient from './AdminLayoutClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const session = await auth();
  if (!canViewAdminPages(session?.user?.role)) {
    return {
      ...privatePageMetadata,
      title: '该页面不存在',
    };
  }
  return {
    ...privatePageMetadata,
    title: '管理后台',
  };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!canViewAdminPages(session?.user?.role)) {
    notFound();
  }

  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
