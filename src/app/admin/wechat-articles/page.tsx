'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Calendar, ExternalLink } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface ArticleListItem {
  slug: string;
  title: string;
  date: string;
  publishedDate: string;
  cover: string;
  issue: string;
  wechatUrl: string;
}

export default function WechatArticlesAdminPage() {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingSlug, setUpdatingSlug] = useState('');
  const [editDate, setEditDate] = useState<Record<string, string>>({});
  const [editPublished, setEditPublished] = useState<Record<string, string>>({});
  const [editUrl, setEditUrl] = useState<Record<string, string>>({});
  const [dirtySlugs, setDirtySlugs] = useState<Set<string>>(new Set());

  const fetchArticles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/wechat-articles');
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      const list: ArticleListItem[] = data.articles ?? [];
      setArticles(list);
      const dMap: Record<string, string> = {};
      const pMap: Record<string, string> = {};
      const uMap: Record<string, string> = {};
      for (const a of list) {
        dMap[a.slug] = a.date ?? '';
        pMap[a.slug] = a.publishedDate ?? '';
        uMap[a.slug] = a.wechatUrl ?? '';
      }
      setEditDate(dMap);
      setEditPublished(pMap);
      setEditUrl(uMap);
      setDirtySlugs(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  function markDirty(slug: string) {
    setDirtySlugs((prev) => new Set(prev).add(slug));
  }

  async function saveArticle(slug: string) {
    setUpdatingSlug(slug);
    try {
      const payload: Record<string, string> = { slug };
      const original = articles.find((a) => a.slug === slug);
      if (original && editDate[slug] !== original.date) payload.date = editDate[slug];
      if (original && editPublished[slug] !== original.publishedDate) payload.publishedDate = editPublished[slug];
      if (original && editUrl[slug] !== original.wechatUrl) payload.wechatUrl = editUrl[slug];

      const res = await fetch('/api/admin/wechat-articles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('保存失败');
      await fetchArticles();
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setUpdatingSlug('');
    }
  }

  function markToday(slug: string) {
    const today = new Date().toISOString().slice(0, 10);
    setEditPublished((prev) => ({ ...prev, [slug]: today }));
    markDirty(slug);
  }

  function clearPublished(slug: string) {
    setEditPublished((prev) => ({ ...prev, [slug]: '' }));
    markDirty(slug);
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-brand-700"
        >
          <ArrowLeft size={16} />
          返回管理概览
        </Link>
        <h1 className="text-xl font-bold text-gray-900">服务号文章管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          修改排期日期或发表日期后点击保存，/discoveries 页面会在下次构建后同步更新。
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError('')} className="ml-3 text-red-400 hover:text-red-600">x</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : articles.length === 0 ? (
        <div className={`rounded-lg p-8 text-center ${uiSurfaces.panel}`}>
          <p className="text-gray-500">暂无文章</p>
        </div>
      ) : (
        <div className={`overflow-x-auto rounded-lg ${uiSurfaces.panel}`}>
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">文章</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">排期日期</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">发表日期</th>
                <th className="px-4 py-3 font-medium">服务号链接</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => {
                const isDirty = dirtySlugs.has(article.slug);
                return (
                  <tr key={article.slug} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{article.title || article.slug}</div>
                      {article.issue && (
                        <div className="mt-0.5 text-xs text-gray-400">{article.issue}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="date"
                        value={editDate[article.slug] ?? ''}
                        onChange={(e) => {
                          setEditDate((prev) => ({ ...prev, [article.slug]: e.target.value }));
                          markDirty(article.slug);
                        }}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs font-mono text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={editPublished[article.slug] ?? ''}
                          onChange={(e) => {
                            setEditPublished((prev) => ({ ...prev, [article.slug]: e.target.value }));
                            markDirty(article.slug);
                          }}
                          className="rounded-md border border-gray-200 px-2 py-1 text-xs font-mono text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                        />
                        <button
                          onClick={() => markToday(article.slug)}
                          title="设为今天"
                          className="rounded p-1 text-xs text-gray-400 hover:text-brand-700 hover:bg-gray-100"
                        >
                          <Calendar size={14} />
                        </button>
                        {editPublished[article.slug] && (
                          <button
                            onClick={() => clearPublished(article.slug)}
                            title="清除"
                            className="rounded px-1 text-xs text-gray-400 hover:text-red-600 hover:bg-gray-100"
                          >
                            x
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editUrl[article.slug] ?? ''}
                          onChange={(e) => {
                            setEditUrl((prev) => ({ ...prev, [article.slug]: e.target.value }));
                            markDirty(article.slug);
                          }}
                          placeholder="https://..."
                          className="w-40 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                        />
                        {article.wechatUrl && (
                          <a
                            href={article.wechatUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-700 hover:text-brand-900"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => saveArticle(article.slug)}
                        disabled={updatingSlug === article.slug || !isDirty}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Save size={12} />
                        {updatingSlug === article.slug ? '保存中...' : '保存'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={`rounded-lg p-4 ${uiSurfaces.panel}`}>
        <h3 className="text-sm font-semibold text-gray-800">使用说明</h3>
        <ol className="mt-2 space-y-1.5 text-xs text-gray-500 list-decimal pl-4">
          <li>排期日期和发表日期均可直接在表格中手动修改，修改后点击「保存」写入 frontmatter</li>
          <li>发表日期列的日历图标可一键设为今天，x 按钮可清除</li>
          <li>服务号链接可在表格中直接编辑，与日期一同保存</li>
          <li>/discoveries 页面在下次构建后显示更新后的日期</li>
        </ol>
      </div>
    </div>
  );
}
