import type { WechatArticleMeta } from '@/data/wechat-articles';

/**
 * 站内 SEO 文章注册表（非微信服务号来源）。
 *
 * 与 content/wechat/ 下的 markdown 文章不同，这里的每篇文章对应
 * src/app/discoveries/<slug>/ 下的独立静态路由页面，正文用 React 组件
 * 维护（表格、示意图、FAQ 结构化数据等需要精细控制的部分）。
 * 元数据供发现页文章列表与归档页复用，字段含义同 WechatArticleMeta。
 */

/** 一抗与二抗区别文章的 FAQ 条目，页面展示与 FAQPage 结构化数据共用。 */
export type DiscoveryArticleFaq = {
  q: string;
  a: string;
};

export const PRIMARY_VS_SECONDARY_ANTIBODY_SLUG = 'primary-vs-secondary-antibody';

/** 页面 H1 与 Article 结构化数据 headline。 */
export const PRIMARY_VS_SECONDARY_ANTIBODY_TITLE = '一抗和二抗有什么区别？种属搭配、按实验选二抗一篇讲清';

/** SEO description（同步写入 metadata 与 Article JSON-LD）。 */
export const PRIMARY_VS_SECONDARY_ANTIBODY_DESCRIPTION =
  '一抗识别目标蛋白，二抗识别一抗。按一抗宿主、亚型和实验类型选二抗，附区别表、种属搭配表和常见搭配错误。';

/** 发布与更新日期（ISO 日期）。 */
export const PRIMARY_VS_SECONDARY_ANTIBODY_PUBLISHED = '2026-10-19';
export const PRIMARY_VS_SECONDARY_ANTIBODY_MODIFIED = '2026-10-19';

/** 列表卡片封面与 Article 结构化数据配图共用；更换封面时两处同步改。 */
export const PRIMARY_VS_SECONDARY_ANTIBODY_COVER = '/images/home/resource-methods.webp';

export const primaryVsSecondaryAntibodyFaqs: DiscoveryArticleFaq[] = [
  {
    q: '一抗是兔源的，二抗该选什么？',
    a: '选抗兔二抗，常见写法是山羊抗兔 IgG (H+L)，驴抗兔 IgG (H+L) 也可以。二抗自身的宿主选山羊、驴都行，别选兔源——同宿主既做不出来，也会把样本里的内源免疫球蛋白一起识别，背景直接失控。多标实验优先选驴抗兔的预吸附款。',
  },
  {
    q: '为什么二抗的宿主不能和一抗相同？',
    a: '二抗靠识别一抗的恒定区起作用，同宿主无法制备出针对自身 IgG 的抗体；更重要的是，同宿主二抗会同时结合样本里的内源免疫球蛋白，背景高到看不出信号。所以二抗宿主必须和一抗、样本都不同。',
  },
  {
    q: '一抗是小鼠 IgG1 或 IgM，二抗怎么匹配？',
    a: 'IgG1 一抗可以选抗小鼠 IgG (H+L)，能覆盖小鼠各 IgG 亚类；对特异性要求严格的实验，直接选抗小鼠 IgG1 亚型抗体。IgM 一抗必须用抗 IgM 的二抗——只抗 IgG 的二抗识别不了 μ 链，孵育完会没有信号。',
  },
  {
    q: '什么时候可以不用二抗？',
    a: '用直标一抗的时候。酶或荧光染料直接标在一抗上，孵育完就能读数，省一步、背景也更低，多标时还不用担心交叉。代价是信号比间接法弱，适合靶蛋白丰度高的实验；低丰度靶蛋白还是走间接法更稳。',
  },
  {
    q: '组织样本和一抗同种属，会出现什么问题？',
    a: '典型场景是鼠单抗染鼠组织：二抗除了结合你加的一抗，还会结合组织里的内源小鼠 IgG，背景一片高，靶点全被盖住。处理办法有三个：换不同宿主的一抗；用 MOM（Mouse on Mouse）封闭试剂或 Fab 片段二抗压低内源背景；或者改用直标一抗，直接不上二抗。另外，一般封闭用二抗宿主的正常血清即可，不要用样本同种属的血清——那相当于又加了一遍 IgG。',
  },
  {
    q: '什么情况要用预吸附二抗或 F(ab\')₂ 二抗？',
    a: '预吸附（cross-adsorbed）二抗把对其他物种免疫球蛋白的交叉反应性吸附掉了，多标实验和交叉风险高的样本首选。F(ab\')₂ 片段去掉了 Fc 段，适合富含 Fc 受体的样本（如脾脏、免疫细胞），减少非特异结合；背景主要来自 Fc 受体时，换 F(ab\')₂ 比加封闭液更管用。',
  },
];

/** 发现页文章列表：SEO 文章注册项（顺序即列表展示来源之一，最终按日期排序）。 */
export const DISCOVERY_SEO_ARTICLES: WechatArticleMeta[] = [
  {
    slug: PRIMARY_VS_SECONDARY_ANTIBODY_SLUG,
    title: PRIMARY_VS_SECONDARY_ANTIBODY_TITLE,
    date: PRIMARY_VS_SECONDARY_ANTIBODY_PUBLISHED,
    publishedDate: PRIMARY_VS_SECONDARY_ANTIBODY_PUBLISHED,
    dateModified: PRIMARY_VS_SECONDARY_ANTIBODY_MODIFIED,
    // 暂复用「发现」栏目头图作为列表卡片封面与结构化数据配图；后续可替换为专属封面图路径（改常量即可同步两处）。
    cover: PRIMARY_VS_SECONDARY_ANTIBODY_COVER,
    summary: PRIMARY_VS_SECONDARY_ANTIBODY_DESCRIPTION,
    issue: '选型指南',
    wechatFirst: false,
  },
];

/**
 * 合并服务号文章与 SEO 文章，按发表日期倒序。
 * 发现页列表和归档页共用，保证两处顺序一致。
 */
export function mergeDiscoveryArticleMetas(fileArticleMetas: WechatArticleMeta[]): WechatArticleMeta[] {
  return [...fileArticleMetas, ...DISCOVERY_SEO_ARTICLES].sort((a, b) => {
    const left = a.publishedDate ?? a.date;
    const right = b.publishedDate ?? b.date;
    return right.localeCompare(left);
  });
}
