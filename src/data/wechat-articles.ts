/**
 * 微信服务号文章的公共类型定义。
 *
 * 文章内容以本地 Markdown 文件维护，位于 content/wechat/ 目录，
 * 每篇一个以三位数字编号开头的 .md 文件，文件名即 slug。
 * 文件开头是 YAML front-matter，字段含义见下方类型。
 */

/** 文章元数据，来自 front-matter，用于列表卡片与 SEO。 */
export type WechatArticleMeta = {
  /** 站内地址 slug，等于去掉扩展名的文件名，例如 001-freezer-archaeology。 */
  slug: string;
  /** 文章标题。 */
  title: string;
  /** 发布日期，ISO 日期字符串（YYYY-MM-DD），用于排序与结构化数据。 */
  date: string;
  /** 实际发表日期，管理员在服务号后台发表后回填。有值时排序和展示优先使用此字段。 */
  publishedDate?: string;
  /** 正文最后修改日期，来自 front-matter 的 dateModified 或 updatedDate，用于文章结构化数据与社交分享元数据。 */
  dateModified?: string;
  /** 封面图站内地址，相对路径或绝对地址。 */
  cover: string;
  /** 一句话摘要，用于列表副文本与页面 description。 */
  summary: string;
  /** 期号，展示用，可选。 */
  issue?: string;
  /** 微信服务号原文永久链接，可选；填写后首发标注带链接。 */
  wechatUrl?: string;
  /** 是否首发于微信服务号，默认 true。设为 false 时不显示首发标注。 */
  wechatFirst: boolean;
};

/** 完整文章，包含正文渲染后的 HTML。 */
export type WechatArticle = WechatArticleMeta & {
  /** 由 markdown-it 渲染后的正文 HTML。 */
  contentHtml: string;
};

/** 发现页文章标签展示的最新文章数量，超出部分在归档页查看。 */
export const WECHAT_ARTICLE_PREVIEW_COUNT = 12;
