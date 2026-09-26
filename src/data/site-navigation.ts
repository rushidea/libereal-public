import { productCategories } from './categories';
import { brandPageHref, getBrandDisplayName } from './brands';
import { researchTrendNavigation } from './research-trends-navigation';
import { scenesNavGroups } from './scenes-navigation';

export type SiteNavigationAction = 'quick-order';

export type SiteNavigationIcon =
  | 'archive'
  | 'atom'
  | 'book-open'
  | 'boxes'
  | 'chart'
  | 'circle-dot'
  | 'code'
  | 'crop'
  | 'database'
  | 'dna'
  | 'eye'
  | 'flask'
  | 'git-branch'
  | 'grid'
  | 'image'
  | 'library'
  | 'microscope'
  | 'network'
  | 'quote'
  | 'scan-line'
  | 'scan-search'
  | 'scatter-chart'
  | 'scissors'
  | 'shield-check'
  | 'table';

export type SiteNavigationLink = {
  id: string;
  label: string;
  href?: string;
  action?: SiteNavigationAction;
  icon?: SiteNavigationIcon;
  children?: SiteNavigationLink[];
};

export type SiteNavigationGroup = {
  id: string;
  label: string;
  links: SiteNavigationLink[];
};

export type SiteNavigationId =
  | 'products'
  | 'research-tools'
  | 'resources'
  | 'academic-support'
  | 'about';

export type SiteNavigationItem = {
  id: SiteNavigationId;
  label: string;
  href: string;
  groups: SiteNavigationGroup[];
  footerLinks: SiteNavigationLink[];
};

const productCategoryLinks: SiteNavigationLink[] = productCategories.map((category) => ({
  id: `category-${category.name}`,
  label: category.name,
  href: `/products/catalog?cat=${encodeURIComponent(category.name)}`,
  children: category.sub.map((subCategory) => ({
    id: `category-${category.name}-${subCategory.name}`,
    label: subCategory.name,
    href: `/products/catalog?cat=${encodeURIComponent(category.name)}&sub=${encodeURIComponent(subCategory.name)}`,
    children: subCategory.child?.map((child) => ({
      id: `category-${category.name}-${subCategory.name}-${child}`,
      label: child,
      href: `/products/catalog?cat=${encodeURIComponent(category.name)}&sub=${encodeURIComponent(subCategory.name)}&type=${encodeURIComponent(child)}`,
    })),
  })),
}));

const researchTrendLink: SiteNavigationLink = {
  id: 'research-trends',
  label: '研究热点',
  href: '/research/trends',
  children: researchTrendNavigation.map((group) => ({
    id: group.id,
    label: group.label,
    children: group.sections.map((section) => ({
      id: section.id,
      label: section.label,
      children: section.topics.map((topic) => ({
        id: topic.id,
        label: topic.label,
        href: topic.href,
      })),
    })),
  })),
};

const productFooterLinks: SiteNavigationLink[] = [
  { id: 'product-catalog', label: '产品目录', href: '/products' },
  { id: 'product-brands', label: '品牌中心', href: '/brands' },
  { id: 'product-promotions', label: '促销产品', href: '/promotions' },
  { id: 'product-quick-order', label: '快速订购', href: '/products/catalog', action: 'quick-order' },
];

const productBrandLinks: SiteNavigationLink[] = [
  { id: 'brand-overview', label: '全部品牌', href: '/brands' },
  { id: 'brand-abcepta', label: getBrandDisplayName('Abcepta'), href: brandPageHref('Abcepta') },
  { id: 'brand-biosharp', label: getBrandDisplayName('Biosharp'), href: brandPageHref('Biosharp') },
  { id: 'brand-cst', label: getBrandDisplayName('CST'), href: brandPageHref('CST') },
  { id: 'brand-abcam', label: getBrandDisplayName('Abcam'), href: brandPageHref('Abcam') },
  { id: 'brand-sigma', label: getBrandDisplayName('Sigma-Aldrich'), href: brandPageHref('Sigma-Aldrich') },
  { id: 'brand-thermo-fisher', label: getBrandDisplayName('Thermo Fisher'), href: brandPageHref('Thermo Fisher') },
  { id: 'brand-labselect', label: getBrandDisplayName('Labselect'), href: brandPageHref('Labselect') },
  { id: 'brand-xianzhi', label: '贤至生物', href: brandPageHref('贤至生物') },
];

const productPromotionLinks: SiteNavigationLink[] = [];

const researchToolLinks: SiteNavigationLink[] = [
  {
    id: 'calculators',
    label: '计算工具',
    href: '/support?tab=calculators',
  },
  {
    id: 'spectra',
    label: '荧光光谱',
    href: '/support?tab=spectra',
  },
  {
    id: 'cd-markers',
    label: 'CD 分子',
    href: '/support?tab=cd-markers',
  },
  {
    id: 'public-tools',
    label: '公共工具与分析软件',
    href: '/scenes#public-tools',
    children: [
      {
        id: 'public-antibody',
        label: '抗体验证与选型',
        children: [
          { id: 'public-antibodypedia', label: 'Antibodypedia', href: 'https://www.antibodypedia.com/', icon: 'shield-check' },
          { id: 'public-citeab', label: 'CiteAb', href: 'https://www.citeab.com/', icon: 'quote' },
          { id: 'public-proteinatlas', label: 'Human Protein Atlas', href: 'https://www.proteinatlas.org/', icon: 'microscope' },
        ],
      },
      {
        id: 'public-cell-analysis',
        label: '细胞图谱与流式分析',
        children: [
          { id: 'public-cell-atlas', label: 'Human Cell Atlas', href: 'https://www.humancellatlas.org/', icon: 'network' },
          { id: 'public-cellxgene', label: 'CELLxGENE Discover', href: 'https://cellxgene.cziscience.com/', icon: 'grid' },
          { id: 'public-scanpy', label: 'Scanpy', href: 'https://scanpy.readthedocs.io/', icon: 'scatter-chart' },
          { id: 'public-seurat', label: 'Seurat', href: 'https://satijalab.org/seurat/', icon: 'circle-dot' },
        ],
      },
      {
        id: 'public-image-analysis',
        label: '图像与空间分析',
        children: [
          { id: 'public-qupath', label: 'QuPath', href: 'https://qupath.github.io/', icon: 'scan-line' },
          { id: 'public-imagej', label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/', icon: 'image' },
          { id: 'public-napari', label: 'napari', href: 'https://napari.org/', icon: 'eye' },
          { id: 'public-cellprofiler', label: 'CellProfiler', href: 'https://cellprofiler.org/releases/', icon: 'scan-search' },
        ],
      },
      {
        id: 'public-sequence-editing',
        label: '序列、引物与基因编辑',
        children: [
          { id: 'public-ncbi-blast', label: 'NCBI BLAST', href: 'https://blast.ncbi.nlm.nih.gov/Blast.cgi', icon: 'dna' },
          { id: 'public-primer3', label: 'Primer3', href: 'https://primer3.ut.ee/', icon: 'scissors' },
          { id: 'public-chopchop', label: 'CHOPCHOP', href: 'https://chopchop.cbu.uib.no/', icon: 'crop' },
          { id: 'public-crispresso', label: 'CRISPResso2', href: 'https://crispresso.pinellolab.org/submission', icon: 'git-branch' },
        ],
      },
      {
        id: 'public-structure-discovery',
        label: '蛋白结构与分子发现',
        children: [
          { id: 'public-rcsb', label: 'RCSB Protein Data Bank', href: 'https://www.rcsb.org/', icon: 'database' },
          { id: 'public-alphafold', label: 'AlphaFold Protein Structure Database', href: 'https://alphafold.ebi.ac.uk/', icon: 'atom' },
          { id: 'public-chembl', label: 'ChEMBL', href: 'https://www.ebi.ac.uk/chembl/', icon: 'flask' },
          { id: 'public-autodock', label: 'AutoDock Vina', href: 'https://github.com/ccsb-scripps/AutoDock-Vina', icon: 'boxes' },
        ],
      },
      {
        id: 'public-proteomics-data',
        label: '蛋白质组与公共数据',
        children: [
          { id: 'public-pride', label: 'PRIDE Archive', href: 'https://www.ebi.ac.uk/pride/', icon: 'archive' },
          { id: 'public-uniprot', label: 'UniProt', href: 'https://www.uniprot.org/', icon: 'book-open' },
          { id: 'public-maxquant', label: 'MaxQuant', href: 'https://www.maxquant.org/', icon: 'chart' },
          { id: 'public-skyline', label: 'Skyline', href: 'https://skyline.ms/project/home/software/Skyline/begin.view', icon: 'table' },
        ],
      },
    ],
  },
];

const sceneResourceLinks: SiteNavigationLink[] = scenesNavGroups.flatMap((group) =>
  group.links.map((link) => ({
    id: `scene-${link.slug}`,
    label: link.label,
    href: `/scenes/${link.slug}`,
  })),
);

const resourceLinks: SiteNavigationLink[] = [
  {
    id: 'scenes',
    label: '应用与场景',
    href: '/scenes',
    children: sceneResourceLinks,
  },
  {
    id: 'protocol-library',
    label: '标准实验方法',
    href: '/protocols',
  },
  {
    id: 'buffers',
    label: '缓冲液配制',
    href: '/support?tab=buffers',
  },
];

const academicLinks: SiteNavigationLink[] = [
  researchTrendLink,
  {
    id: 'journals',
    label: '期刊论文',
    href: '/discoveries?tab=journals',
    children: [
      { id: 'journal-jbr', label: 'Journal of Biomedical Research', href: '/discoveries?tab=journals&journal=jbr' },
      { id: 'journal-cmi', label: 'Cellular & Molecular Immunology', href: '/discoveries?tab=journals&journal=cmi' },
      { id: 'journal-cjnm', label: 'Chinese Journal of Natural Medicines', href: '/discoveries?tab=journals&journal=cjnm' },
    ],
  },
  {
    id: 'wechat-articles',
    label: '服务号文章',
    href: '/discoveries',
    children: [
      { id: 'wechat-archive', label: '文章归档', href: '/discoveries/articles' },
    ],
  },
  {
    id: 'faqs',
    label: '常见问题',
    href: '/faq',
    children: [
      { id: 'faq-support', label: '支持中心问答', href: '/support?tab=faqs' },
    ],
  },
  {
    id: 'technical-support',
    label: '技术支持',
    href: '/contact',
    children: [
      { id: 'support-center', label: '技术支持中心', href: '/support' },
    ],
  },
];

export const siteNavigation: SiteNavigationItem[] = [
  {
    id: 'products',
    label: '产品中心',
    href: '/products',
    groups: [
      {
        id: 'product-catalog',
        label: '产品目录',
        links: productCategoryLinks,
      },
      {
        id: 'product-brands',
        label: '品牌中心',
        links: productBrandLinks,
      },
      {
        id: 'product-promotions',
        label: '促销产品',
        links: productPromotionLinks,
      },
    ],
    footerLinks: productFooterLinks,
  },
  {
    id: 'research-tools',
    label: '研究工具',
    href: '/research-tools',
    groups: [
      {
        id: 'research-tool-index',
        label: '研究工具',
        links: researchToolLinks,
      },
    ],
    footerLinks: researchToolLinks,
  },
  {
    id: 'resources',
    label: '资源中心',
    href: '/resources',
    groups: [
      {
        id: 'resource-library',
        label: '实验资源',
        links: resourceLinks,
      },
    ],
    footerLinks: resourceLinks,
  },
  {
    id: 'academic-support',
    label: '学术支持',
    href: '/academic-support',
    groups: [
      {
        id: 'academic-library',
        label: '学术资料',
        links: academicLinks,
      },
    ],
    footerLinks: academicLinks,
  },
  {
    id: 'about',
    label: '关于我们',
    href: '/about',
    groups: [
      {
        id: 'company',
        label: '公司信息',
        links: [
          { id: 'company-intro', label: '公司介绍', href: '/about' },
          { id: 'site-updates', label: '网站更新', href: '/updates' },
          { id: 'contact', label: '联系我们', href: '/contact' },
          { id: 'open-platform', label: '开放平台', href: '/open-platform' },
          { id: 'service-promise', label: '服务承诺', href: '/promise' },
          { id: 'legal-terms', label: '法律条款', href: '/legal' },
        ],
      },
    ],
    footerLinks: [
      { id: 'company-intro', label: '公司介绍', href: '/about' },
      { id: 'site-updates', label: '网站更新', href: '/updates' },
      { id: 'contact', label: '联系我们', href: '/contact' },
      { id: 'open-platform', label: '开放平台', href: '/open-platform' },
      { id: 'service-promise', label: '服务承诺', href: '/promise' },
      { id: 'legal-terms', label: '法律条款', href: '/legal' },
    ],
  },
];

export const mobileSiteNavigation = siteNavigation.filter((item) => item.id !== 'products');

export const siteNavigationById = Object.fromEntries(
  siteNavigation.map((item) => [item.id, item]),
) as Record<SiteNavigationId, SiteNavigationItem>;

export function getNavigationLinkHref(link: SiteNavigationLink): string | undefined {
  return link.href;
}
