import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdaptiveHeaderWithProductSearch from '@/components/AdaptiveHeaderWithProductSearch';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { getProductSeoCategory, productCategoryCatalogHref, productSeoCategories } from '@/data/product-seo';
import { brandPageHref } from '@/data/brands';
import JsonLd from '@/components/JsonLd';
import { buildBreadcrumbListJsonLd } from '@/lib/seo/json-ld';
import { canonicalSiteUrl } from '@/lib/site-url';

type CategoryPageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return productSeoCategories.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getProductSeoCategory(slug);
  if (!category) return { robots: { index: false, follow: true } };
  return {
    title: category.title,
    description: category.description,
    alternates: { canonical: canonicalSiteUrl(`/products/categories/${category.slug}`) },
  };
}

export default async function ProductSeoCategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = getProductSeoCategory(slug);
  if (!category) notFound();

  const relatedCategories = category.relatedSlugs
    .map((relatedSlug) => getProductSeoCategory(relatedSlug))
    .filter((related): related is NonNullable<typeof related> => Boolean(related));

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeaderWithProductSearch showNav />
      <JsonLd data={buildBreadcrumbListJsonLd([
        { name: '首页', path: '/' },
        { name: '产品分类', path: '/products/categories' },
        { name: category.heading },
      ])} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24 lg:pb-12">
        <nav aria-label="面包屑" className="mb-6 text-sm text-gray-500">
          <Link href="/" className="hover:text-brand-600">首页</Link>
          <span className="mx-2">/</span>
          <Link href="/products/categories" className="hover:text-brand-600">产品分类</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-700">{category.heading}</span>
        </nav>

        <header className="rounded-3xl border border-white/70 bg-white/75 p-6 shadow-sm sm:p-9">
          <p className="text-sm font-medium text-brand-600">LIBEREAL 产品分类</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-gray-900">{category.heading}</h1>
          <p className="mt-4 max-w-3xl leading-relaxed text-gray-600">{category.intro}</p>
        </header>

        <section aria-labelledby="catalog-heading" className="mt-8">
          <h2 id="catalog-heading" className="text-xl font-semibold text-gray-900">浏览对应产品目录</h2>
          <p className="mt-2 text-sm text-gray-600">选择分类后可在目录中继续筛选产品；具体产品信息请以各产品详情为准。</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {category.catalogFilters.map((filter) => {
              const label = filter.productType ?? filter.subcategory ?? filter.category;
              return (
                <Link key={`${filter.category}-${filter.subcategory ?? ''}`} href={productCategoryCatalogHref(filter)} className="rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm font-medium text-brand-700 transition hover:border-brand-400 hover:bg-brand-50">
                  {label} →
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="selection-heading" className="mt-10 rounded-2xl border border-white/70 bg-white/70 p-6">
          <h2 id="selection-heading" className="text-xl font-semibold text-gray-900">{category.selectionTitle}</h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-gray-600">
            {category.selection.map((item) => <li key={item} className="flex gap-3"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brand-500" /><span>{item}</span></li>)}
          </ul>
        </section>

        {category.brandNote ? (
          <aside className="mt-8 rounded-2xl border border-sky-100 bg-sky-50/70 p-5 text-sm leading-relaxed text-gray-700">
            <p>{category.brandNote}</p>
            <Link href="/inquiry" className="mt-3 inline-flex font-medium text-brand-700 hover:text-brand-800">提交询价需求 →</Link>
          </aside>
        ) : null}

        {category.relatedBrands.length || category.inquiryBrands?.length ? (
          <section aria-labelledby="brands-heading" className="mt-8">
            <h2 id="brands-heading" className="text-xl font-semibold text-gray-900">相关品牌与询价</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {category.relatedBrands.map((brand) => (
                <Link key={brand} href={brandPageHref(brand)} className="rounded-xl border border-white/70 bg-white/75 px-4 py-2 text-sm text-gray-700 hover:border-brand-300 hover:text-brand-700">{brand} 品牌目录</Link>
              ))}
              {category.inquiryBrands?.map((brand) => (
                <Link key={brand} href={brandPageHref(brand)} className="rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-2 text-sm text-sky-800 hover:border-sky-300">{brand} 品牌与询价</Link>
              ))}
            </div>
          </section>
        ) : null}

        {relatedCategories.length ? (
          <nav aria-label="相关产品分类" className="mt-10 border-t border-gray-200 pt-6">
            <h2 className="text-lg font-semibold text-gray-900">相关分类</h2>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {relatedCategories.map((related) => <Link key={related.slug} href={`/products/categories/${related.slug}`} className="text-sm text-brand-700 hover:underline">{related.heading}</Link>)}
            </div>
          </nav>
        ) : null}
      </main>
      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
