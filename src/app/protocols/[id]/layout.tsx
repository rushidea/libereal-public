import type { Metadata } from 'next';
import { getProtocolById } from '@/data/protocols-detail';
import { canonicalSiteUrl } from '@/lib/site-url';

export const revalidate = 3600;

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const protocol = getProtocolById(id);
  if (!protocol) {
    return { title: '方案未找到', robots: { index: false, follow: true } };
  }
  return {
    title: protocol.title,
    description: protocol.description,
    alternates: {
      canonical: canonicalSiteUrl(`/protocols/${protocol.id}`),
    },
  };
}

export default function ProtocolDetailLayout({ children }: LayoutProps) {
  return children;
}
