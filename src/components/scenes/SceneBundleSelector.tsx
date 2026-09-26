'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, ExternalLink, ShoppingBag, Star } from 'lucide-react';
import type { SceneBundle, SceneIntent, SceneLevel } from '@/data/scenes';
import { sceneIntentLabels, sceneLevelLabels } from '@/data/scenes';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';

const LEVELS: SceneLevel[] = ['beginner', 'intermediate', 'expert'];
const INTENTS: SceneIntent[] = ['first', 'repeat'];

type Props = {
  bundles: Record<SceneLevel, Record<SceneIntent, SceneBundle>>;
  theme: SceneTheme;
  sceneTitle: string;
};

export default function SceneBundleSelector({ bundles, theme, sceneTitle }: Props) {
  const t = theme;
  const [level, setLevel] = useState<SceneLevel>('beginner');
  const [intent, setIntent] = useState<SceneIntent>('first');
  const [copied, setCopied] = useState(false);

  const bundle = bundles[level][intent];

  function buildCopyText(): string {
    const lines = [
      `${sceneTitle} · ${bundle.title}`,
      bundle.summary,
      '',
      '【必买】',
      ...bundle.required.map((item) => `· ${item}`),
      '',
      '【推荐配置】',
      ...bundle.recommended.map((item) => `· ${item}`),
    ];
    if (bundle.upgrades.length > 0) {
      lines.push('', '【可选升级】', ...bundle.upgrades.map((item) => `· ${item}`));
    }
    lines.push('', '说明：具体货号与品牌请至产品中心选型。');
    return lines.join('\n');
  }

  async function handleCopy() {
    const text = buildCopyText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className={`mb-8 p-4 sm:p-5 ${sceneSurfaceClasses.section}`}>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${t.stepBadge}`}>
            <ShoppingBag className="h-4 w-4" />
            分级选购建议
          </div>
          <h2 className={`text-xl font-bold ${sceneSurfaceClasses.text}`}>我该买什么？</h2>
          <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>
            选择您的经验阶段与采购目的，查看对应的必买清单与产品建议。
          </p>
        </div>
      </div>

      {/* 等级 + 意图选择 */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className={`flex gap-1 rounded-brand border p-1 ${sceneSurfaceClasses.subPanel}`}>
          {LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevel(lv)}
              className={`flex-1 rounded-brand px-3 py-2 text-sm font-medium transition ${sceneSurfaceClasses.focusRing} ${
                level === lv
                  ? `${t.activeBg} ${t.strongText} border ${t.activeBorder} shadow-sm`
                  : `${sceneSurfaceClasses.mutedText} hover:text-[var(--brand-color-text)]`
              }`}
            >
              {sceneLevelLabels[lv]}
            </button>
          ))}
        </div>
        <div className={`flex gap-1 rounded-brand border p-1 ${sceneSurfaceClasses.subPanel}`}>
          {INTENTS.map((it) => (
            <button
              key={it}
              type="button"
              onClick={() => setIntent(it)}
              className={`flex-1 rounded-brand px-4 py-2 text-sm font-medium transition ${sceneSurfaceClasses.focusRing} ${
                intent === it
                  ? `${t.activeBg} ${t.strongText} border ${t.activeBorder} shadow-sm`
                  : `${sceneSurfaceClasses.mutedText} hover:text-[var(--brand-color-text)]`
              }`}
            >
              {sceneIntentLabels[it]}
            </button>
          ))}
        </div>
      </div>

      {/* Bundle 内容 */}
      <div className={`p-4 ${sceneSurfaceClasses.subPanel}`}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={`text-base font-semibold ${sceneSurfaceClasses.text}`}>{bundle.title}</p>
            <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{bundle.summary}</p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={`inline-flex shrink-0 items-center gap-2 rounded-brand px-4 py-2 text-sm font-medium text-white ${t.primaryBtn} ${t.primaryBtnHover} ${sceneSurfaceClasses.focusRing}`}
          >
            <Copy className="h-4 w-4" />
            {copied ? '已复制' : '复制清单'}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* 必买 */}
          <div className={`p-3 ${sceneSurfaceClasses.card}`}>
            <div className="mb-2 flex items-center gap-1.5">
              <CheckCircle2 className={`h-4 w-4 ${t.sectionIcon}`} />
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>必买</p>
            </div>
            <ul className="space-y-1.5">
              {bundle.required.map((item) => (
                <li key={item} className={`flex items-start gap-2 text-sm ${sceneSurfaceClasses.text}`}>
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${t.primaryBtn}`} />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* 推荐配置 */}
          <div className={`p-3 ${sceneSurfaceClasses.card}`}>
            <div className="mb-2 flex items-center gap-1.5">
              <Star className="h-4 w-4 text-amber-500" />
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>推荐配置</p>
            </div>
            <ul className="space-y-1.5">
              {bundle.recommended.map((item) => (
                <li key={item} className={`flex items-start gap-2 text-sm ${sceneSurfaceClasses.text}`}>
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* 可选升级 */}
          <div className={`p-3 ${sceneSurfaceClasses.card}`}>
            <div className="mb-2 flex items-center gap-1.5">
              <ExternalLink className="h-4 w-4 text-slate-400" />
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>可选升级</p>
            </div>
            <ul className="space-y-1.5">
              {bundle.upgrades.map((item) => (
                <li key={item} className={`flex items-start gap-2 text-sm ${sceneSurfaceClasses.mutedText}`}>
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 产品类目链接 */}
        {bundle.productLinks.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className={`text-xs ${sceneSurfaceClasses.mutedText}`}>产品中心：</p>
            {bundle.productLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${t.linkChip} ${t.linkChipHover} ${sceneSurfaceClasses.card} ${sceneSurfaceClasses.focusRing}`}
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <p className={`mt-3 text-xs ${sceneSurfaceClasses.mutedText}`}>
        仅供参考，具体品牌与货号请至产品中心选型；不同实验室和样本情况可能有所不同。
      </p>
    </section>
  );
}
