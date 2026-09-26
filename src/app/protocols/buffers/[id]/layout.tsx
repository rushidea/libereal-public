import type { Metadata } from 'next';
import { getBufferById } from '@/data/buffers-detail';
import { canonicalSiteUrl } from '@/lib/site-url';

export const revalidate = 3600;

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const buffer = getBufferById(id);
  if (!buffer) {
    return { title: '配方未找到', robots: { index: false, follow: true } };
  }
  return {
    title: buffer.name,
    description: buffer.description,
    alternates: {
      canonical: canonicalSiteUrl(`/protocols/buffers/${buffer.id}`),
    },
  };
}

export default function BufferDetailLayout({ children }: LayoutProps) {
  return children;
}
