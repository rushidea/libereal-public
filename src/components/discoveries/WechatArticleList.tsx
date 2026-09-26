import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, BookOpenText } from 'lucide-react';
import type { WechatArticleMeta } from '@/data/wechat-articles';
import { uiSurfaces } from '@/lib/ui-surfaces';

type WechatArticleListProps = {
  articles: WechatArticleMeta[];
  /** 提供时在列表底部显示“查看全部”入口，指向归档页。 */
  showAllHref?: string;
};

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export default function WechatArticleList({ articles, showAllHref }: WechatArticleListProps) {
  if (articles.length === 0) {
    return (
      <div className={`rounded-lg p-8 text-center ${uiSurfaces.panel}`}>
        <BookOpenText className={`mx-auto h-8 w-8 ${uiSurfaces.textSecondary}`} />
        <p className={`mt-3 ${uiSurfaces.mutedText}`}>暂无服务号文章</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => (
          <Link
            key={article.slug}
            href={`/discoveries/${article.slug}`}
            className={`group flex flex-col overflow-hidden rounded-lg transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_45px_rgba(71,85,105,0.16)] ${uiSurfaces.panel} ${uiSurfaces.focusRing}`}
          >
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-200/60">
              <Image
                src={article.cover}
                alt={article.title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <div className="flex flex-1 flex-col px-5 py-4">
              <div className={`flex items-center gap-2 text-xs ${uiSurfaces.textSecondary}`}>
                {article.issue ? <span className={`font-semibold ${uiSurfaces.textInteractive}`}>{article.issue}</span> : null}
                <time dateTime={article.publishedDate ?? article.date} className="font-mono tabular-nums">{formatDate(article.publishedDate ?? article.date)}</time>
              </div>
              <h3 className={`mt-2 line-clamp-2 text-pretty text-base font-semibold leading-6 ${uiSurfaces.titleText}`}>
                {article.title}
              </h3>
              <p className={`mt-2 line-clamp-3 flex-1 text-pretty text-sm leading-6 ${uiSurfaces.mutedText}`}>
                {article.summary}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {showAllHref ? (
        <div className="flex justify-center">
          <Link href={showAllHref} className={uiSurfaces.linkButton}>
            查看全部文章
            <ArrowRight size={16} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
