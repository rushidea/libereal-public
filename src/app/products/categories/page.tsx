import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import AdaptiveHeaderWithProductSearch from '@/components/AdaptiveHeaderWithProductSearch';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { productSeoCategories } from '@/data/product-seo';
import { brandPageHref } from '@/data/brands';
import { canonicalSiteUrl } from '@/lib/site-url';

const categoryBrands = [
  { name: 'Thermo Fisher', description: '仪器、科研试剂与实验耗材等多条产品线；请按具体品牌和产品资料核对。' },
  { name: 'Abcam', description: '抗体及免疫检测相关产品；通过品牌目录查看当前展示内容。' },
  { name: 'CST', description: '细胞信号与磷酸化研究相关抗体及试剂；具体应用验证以产品资料为准。' },
  { name: 'Proteintech', description: '抗体相关采购需求可先查看品牌入口并提交询价，目录展示情况以页面为准。' },
  { name: '近岸蛋白（NovoProtein）', dbName: '近岸蛋白', description: '重组蛋白与细胞因子相关需求可查看品牌入口并询价；目录展示情况以页面为准。' },
];

export const metadata: Metadata = {
  title: '科研试剂与实验耗材分类',
  description: '按抗体、ELISA 试剂盒、Western Blot 相关试剂和细胞培养板、培养瓶等实验需求浏览分类，查看选型核对要点并进入现有目录筛选产品；具体规格、验证信息和目录覆盖请以页面产品资料为准。',
  alternates: { canonical: canonicalSiteUrl('/products/categories') },
};

export default function ProductCategoriesPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeaderWithProductSearch showNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 pb-24 lg:pb-12">
        <p className="text-sm font-medium text-brand-600">产品分类</p>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">按实验需求浏览科研产品</h1>
        <p className="mt-4 max-w-3xl leading-relaxed text-gray-600">从实验步骤和耗材用途进入产品目录。各分类页提供选型核对要点，并链接到可继续筛选的目录分类。</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {productSeoCategories.map((category) => (
            <Link key={category.slug} href={`/products/categories/${category.slug}`} className="group rounded-2xl border border-white/70 bg-white/75 p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <h2 className="text-lg font-semibold text-gray-900">{category.heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{category.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600">查看分类 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
            </Link>
          ))}
        </div>
        <section aria-labelledby="category-brands-heading" className="mt-12">
          <h2 id="category-brands-heading" className="text-2xl font-semibold text-gray-900">品牌与采购</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">品牌页展示目录中可浏览的产品信息。对于当前目录未展示的具体型号，也可通过询价入口沟通需求；该入口不代表现货或库存承诺。</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categoryBrands.map((brand) => (
              <Link key={brand.name} href={brandPageHref(brand.dbName ?? brand.name)} className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-sm transition hover:border-brand-200 hover:shadow-md">
                <h3 className="font-semibold text-gray-900">{brand.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{brand.description}</p>
                <span className="mt-3 inline-block text-sm font-medium text-brand-700">品牌与询价 →</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
