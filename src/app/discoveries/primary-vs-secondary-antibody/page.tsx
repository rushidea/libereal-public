import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import PrimaryVsSecondaryAntibodyClient from './PrimaryVsSecondaryAntibodyClient';
import { buildBreadcrumbListJsonLd, buildFaqPageJsonLd } from '@/lib/seo/json-ld';
import { canonicalSiteUrl } from '@/lib/site-url';
import {
  PRIMARY_VS_SECONDARY_ANTIBODY_DESCRIPTION,
  PRIMARY_VS_SECONDARY_ANTIBODY_MODIFIED,
  PRIMARY_VS_SECONDARY_ANTIBODY_PUBLISHED,
  PRIMARY_VS_SECONDARY_ANTIBODY_SLUG,
  PRIMARY_VS_SECONDARY_ANTIBODY_TITLE,
  primaryVsSecondaryAntibodyFaqs,
} from '@/data/discovery-seo-articles';

const PUBLISHER = 'LIBEREAL 天放生物';

const url = canonicalSiteUrl(`/discoveries/${PRIMARY_VS_SECONDARY_ANTIBODY_SLUG}`);

export const metadata: Metadata = {
  title: '一抗二抗区别与种属搭配指南（WB/IHC/流式/ELISA）',
  description: PRIMARY_VS_SECONDARY_ANTIBODY_DESCRIPTION,
  alternates: {
    canonical: url,
  },
  openGraph: {
    type: 'article',
    title: '一抗二抗区别与种属搭配指南（WB/IHC/流式/ELISA）| LIBEREAL',
    description: PRIMARY_VS_SECONDARY_ANTIBODY_DESCRIPTION,
    url,
    publishedTime: PRIMARY_VS_SECONDARY_ANTIBODY_PUBLISHED,
    modifiedTime: PRIMARY_VS_SECONDARY_ANTIBODY_MODIFIED,
  },
};

export default function PrimaryVsSecondaryAntibodyPage() {
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: PRIMARY_VS_SECONDARY_ANTIBODY_TITLE,
    description: PRIMARY_VS_SECONDARY_ANTIBODY_DESCRIPTION,
    datePublished: PRIMARY_VS_SECONDARY_ANTIBODY_PUBLISHED,
    dateModified: PRIMARY_VS_SECONDARY_ANTIBODY_MODIFIED,
    mainEntityOfPage: url,
    author: { '@type': 'Organization', name: PUBLISHER },
    publisher: { '@type': 'Organization', name: PUBLISHER },
  };

  return (
    <>
      <PrimaryVsSecondaryAntibodyClient />
      <JsonLd data={articleJsonLd} />
      <JsonLd data={buildFaqPageJsonLd(primaryVsSecondaryAntibodyFaqs)} />
      <JsonLd
        data={buildBreadcrumbListJsonLd([
          { name: '首页', path: '/' },
          { name: '发现', path: '/discoveries' },
          { name: PRIMARY_VS_SECONDARY_ANTIBODY_TITLE },
        ])}
      />
    </>
  );
}
