import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import { experimentFaqCategories, experimentFaqItems } from '@/data/experiment-faqs';
import { buildFaqPageJsonLd } from '@/lib/seo/json-ld';
import { canonicalSiteUrl } from '@/lib/site-url';
import FaqClient from './FaqClient';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: '常见实验问题',
  description: '覆盖细胞培养、Western Blot、ELISA、流式、IHC、免疫沉淀的常见实验问题与处理办法。',
  alternates: {
    canonical: canonicalSiteUrl('/faq'),
  },
};

export default function FaqPage() {
  return (
    <>
      <JsonLd data={buildFaqPageJsonLd(experimentFaqItems)} />
      <FaqClient categories={experimentFaqCategories} />
    </>
  );
}
