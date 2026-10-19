'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ClipboardList,
  FlaskConical,
  Microscope,
  ShoppingCart,
  Square,
} from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import QuickOrderModal from '@/components/QuickOrderModal';
import SiteFooter from '@/components/SiteFooter';
import { uiSurfaces } from '@/lib/ui-surfaces';
import {
  PRIMARY_VS_SECONDARY_ANTIBODY_MODIFIED,
  primaryVsSecondaryAntibodyFaqs,
} from '@/data/discovery-seo-articles';

/** 目录链接：中文分类参数统一编码，与站内 catalog 页的 cat/sub 约定保持一致。 */
function catalogHref(cat: string, sub?: string): string {
  const params = new URLSearchParams({ cat });
  if (sub) params.set('sub', sub);
  return `/products/catalog?${params.toString()}`;
}

const linkClass =
  'font-medium text-brand-700 underline decoration-brand-300/70 underline-offset-2 transition hover:text-brand-900 dark:text-brand-400 dark:decoration-brand-500/50 dark:hover:text-brand-300';

const h2Class = 'mt-12 scroll-mt-24 text-xl font-semibold text-slate-950 dark:text-slate-900 sm:text-2xl';
const h3Class = 'mt-8 text-base font-semibold text-slate-900 dark:text-slate-100 sm:text-lg';
const bodyClass = 'mt-3 text-[15px] leading-7 text-slate-700 dark:text-slate-300';
const tableWrapClass = 'mt-4 overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-700/60';
const tableClass = 'w-full min-w-[600px] border-collapse text-left text-sm';
const thClass = 'bg-slate-50 px-4 py-2.5 font-semibold text-slate-900 dark:bg-slate-800/60 dark:text-slate-100';
const tdClass = 'border-t border-slate-200/80 px-4 py-3 align-top text-slate-700 dark:border-slate-700/60 dark:text-slate-300';

const CTA_BUTTON_CLASS = `${uiSurfaces.buttonPrimary} inline-flex min-h-11 items-center gap-2 px-5 text-sm`;

const DIAGRAM_BASELINE_Y = 168;

/** 示意图里的 Y 形抗体：stub 落在基线上，顶端两臂，圆点代表酶/荧光标记。 */
function DiagramAntibody({ x, className }: { x: number; className: string }) {
  const topY = 92;
  return (
    <g className={className} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" fill="none">
      <path d={`M ${x} ${DIAGRAM_BASELINE_Y - 8} L ${x} ${topY + 10}`} />
      <path d={`M ${x} ${topY + 10} L ${x - 16} ${topY}`} />
      <path d={`M ${x} ${topY + 10} L ${x + 16} ${topY}`} />
    </g>
  );
}

function DiagramPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <g>
      <rect x={0} y={0} width={320} height={236} rx={12} className="fill-slate-50 dark:fill-slate-800/40" />
      <text x={160} y={30} textAnchor="middle" className="fill-slate-900 text-[15px] font-semibold dark:fill-slate-100">
        {title}
      </text>
      {children}
    </g>
  );
}

/** 直接法 vs 间接法示意图：靶蛋白固定画在基线上，抗体用 Y 形表示，圆点代表酶/荧光标记。 */
function DetectionMethodDiagram() {
  return (
    <svg
      viewBox="0 0 680 236"
      role="img"
      aria-label="示意图：直接法使用带酶或荧光标记的直标一抗，一步孵育即可检测靶蛋白；间接法先用不带标记的一抗结合靶蛋白，再用带标记的二抗结合一抗，通过多个二抗分子放大信号。"
      className="mt-4 h-auto w-full"
    >
      <title>直接法与间接法检测示意图</title>
      <desc>
        左图为直接法：带标记的直标一抗直接结合靶蛋白。右图为间接法：不带标记的一抗先结合靶蛋白，带标记的二抗再结合一抗，实现信号放大。
      </desc>

      {/* 直接法 */}
      <g transform="translate(16, 0)">
        <DiagramPanel title="直接法：1 步孵育">
          <line
            x1={24}
            y1={DIAGRAM_BASELINE_Y}
            x2={296}
            y2={DIAGRAM_BASELINE_Y}
            className="text-slate-400"
            stroke="currentColor"
            strokeWidth={2}
          />
          <rect x={152} y={DIAGRAM_BASELINE_Y - 7} width={16} height={14} rx={3} className="fill-rose-500" />
          <DiagramAntibody x={160} className="text-slate-600 dark:text-slate-300" />
          <circle cx={160} cy={78} r={5} className="fill-brand-600 dark:fill-brand-400" />
          <text x={160} y={196} textAnchor="middle" className="fill-slate-600 text-xs dark:fill-slate-400">
            靶蛋白 + 直标一抗（带标记）
          </text>
          <text x={160} y={218} textAnchor="middle" className="fill-slate-500 text-xs dark:fill-slate-500">
            信号强度：一个抗体一个标记
          </text>
        </DiagramPanel>
      </g>

      {/* 间接法 */}
      <g transform="translate(344, 0)">
        <DiagramPanel title="间接法：2 步孵育，信号放大">
          <line
            x1={24}
            y1={DIAGRAM_BASELINE_Y}
            x2={296}
            y2={DIAGRAM_BASELINE_Y}
            className="text-slate-400"
            stroke="currentColor"
            strokeWidth={2}
          />
          <rect x={152} y={DIAGRAM_BASELINE_Y - 7} width={16} height={14} rx={3} className="fill-rose-500" />
          <DiagramAntibody x={160} className="text-slate-600 dark:text-slate-300" />
          <DiagramAntibody x={128} className="text-brand-600 dark:text-brand-400" />
          <DiagramAntibody x={192} className="text-brand-600 dark:text-brand-400" />
          <circle cx={128} cy={78} r={5} className="fill-brand-600 dark:fill-brand-400" />
          <circle cx={192} cy={78} r={5} className="fill-brand-600 dark:fill-brand-400" />
          <text x={160} y={196} textAnchor="middle" className="fill-slate-600 text-xs dark:fill-slate-400">
            靶蛋白 + 一抗 + 二抗（带标记）
          </text>
          <text x={160} y={218} textAnchor="middle" className="fill-slate-500 text-xs dark:fill-slate-500">
            信号强度：一个一抗结合多个二抗
          </text>
        </DiagramPanel>
      </g>
    </svg>
  );
}

export default function PrimaryVsSecondaryAntibodyClient() {
  const [showQuickOrder, setShowQuickOrder] = useState(false);

  return (
    <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader showNav showQuickOrder onQuickOrderToggle={() => setShowQuickOrder(true)} />

      <main className="mx-auto max-w-3xl px-4 pb-14 sm:px-6">
        <Link
          href="/discoveries"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand-color-text-secondary)] transition hover:text-[var(--brand-color-text)]"
        >
          <ArrowLeft size={16} />
          返回发现
        </Link>

        <article className={`overflow-hidden rounded-lg ${uiSurfaces.panel}`}>
          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-600">
              <span className="font-semibold text-brand-700 dark:text-brand-400">选型指南</span>
              <time dateTime={PRIMARY_VS_SECONDARY_ANTIBODY_MODIFIED} className="font-mono tabular-nums">
                2026 年 10 月 19 日
              </time>
            </div>

            <h1 className="mt-3 text-2xl font-semibold leading-9 text-slate-950 text-pretty dark:text-slate-900 sm:text-3xl">
              一抗和二抗有什么区别？种属搭配、按实验选二抗一篇讲清
            </h1>

            {/* 导语：先给结论，再给直达锚点 */}
            <p className="mt-5 rounded-lg border border-brand-100 bg-brand-50/60 px-4 py-3 text-[15px] leading-7 text-slate-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-slate-200">
              一抗识别目标蛋白，决定检测特异性；二抗识别一抗，带标记并放大信号。二抗怎么选不用背规则，按一抗宿主、一抗亚型和实验类型三步就能定。本文附区别表、种属搭配表、按实验选型表和常见错误清单，拿着货号就能对照下单。
            </p>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              赶时间可以直接看：
              <a href="#difference-table" className={`ml-1 ${linkClass}`}>一抗 vs 二抗区别表</a>、
              <a href="#species-matching" className={`mx-1 ${linkClass}`}>种属搭配表</a>、
              <a href="#checklist" className={`mx-1 ${linkClass}`}>下单前核对清单</a>。
            </p>

            {/* H2 一抗和二抗是什么 */}
            <h2 className={h2Class}>一抗和二抗是什么</h2>
            <p className={bodyClass}>
              一抗是和目标蛋白结合的第一层抗体，二抗是结合在一抗上的第二层抗体——检测的特异性和信号，分别由它们把守。
            </p>

            <h3 className={h3Class}>一抗：识别目标抗原，决定检测的特异性</h3>
            <p className={bodyClass}>
              一抗（primary antibody）直接结合你要检测的目标蛋白。实验认不认得到靶点、会不会认错蛋白，基本由它决定，所以买一抗时看的应用验证（WB、IHC、流式）、物种反应性和克隆类型，说的都是同一件事。一抗多数不带标记，兔、小鼠、大鼠是最常见的宿主，也有相当一部分是重组抗体。
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              按应用挑一抗，可以逛
              <Link href={catalogHref('一抗')} className={`mx-1 ${linkClass}`}>一抗目录</Link>
              ，里面按 WB、IHC、流式等应用分了子目录。
            </p>

            <h3 className={h3Class}>二抗：识别一抗的宿主和亚型，带标记，负责放大信号</h3>
            <p className={bodyClass}>
              二抗（secondary antibody）不碰你的目标蛋白，它认的是一抗：抗兔二抗结合兔源一抗，抗鼠二抗结合鼠源一抗。一个一抗分子上可以结合多个二抗，信号因此被放大；显色、发光、荧光这些「读出」方式，也靠二抗携带的 HRP、AP 或荧光染料实现。
            </p>

            <h3 className={h3Class}>直接法和间接法</h3>
            <p className={bodyClass}>
              直接法用自带标记的直标一抗，孵育一步就能读数；间接法用不带标记的一抗加带标记的二抗，多一步孵育，换来信号放大和「换一抗不用换二抗」的通用性。市面上多数检测走间接法，直标一抗更多用在多标和怕交叉的场景。
            </p>
            <DetectionMethodDiagram />
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              想省二抗这一步，可以看
              <Link href={catalogHref('一抗', '直标抗体')} className={`mx-1 ${linkClass}`}>直标抗体</Link>
              目录。
            </p>

            {/* H2 区别表 */}
            <h2 id="difference-table" className={h2Class}>一抗 vs 二抗区别表</h2>
            <p className={bodyClass}>
              一张表看完分工：一抗管「认不认得出」，二抗管「信号亮不亮」。
            </p>
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>对比项</th>
                    <th className={thClass}>一抗</th>
                    <th className={thClass}>二抗</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>识别对象</td>
                    <td className={tdClass}>目标蛋白（抗原），如 GAPDH、CD3</td>
                    <td className={tdClass}>一抗的恒定区，按宿主和亚型识别，如兔 IgG、小鼠 IgG1</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>来源与宿主</td>
                    <td className={tdClass}>兔、小鼠、大鼠、山羊等宿主免疫制备，也有重组抗体</td>
                    <td className={tdClass}>多由山羊、驴等宿主制备，宿主与一抗、样本都不同</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>是否带标记</td>
                    <td className={tdClass}>多数不带标记，直标抗体除外</td>
                    <td className={tdClass}>带标记：HRP、AP、荧光染料、生物素</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>决定什么</td>
                    <td className={tdClass}>检测特异性——认不认得到靶点</td>
                    <td className={tdClass}>灵敏度与读出方式——信号多强、用什么仪器看</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>选择依据</td>
                    <td className={tdClass}>靶蛋白、应用、物种反应性、验证数据</td>
                    <td className={tdClass}>一抗宿主、一抗亚型、实验类型、仪器通道</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>能否省略</td>
                    <td className={tdClass}>不能，没有一抗就没有特异性识别</td>
                    <td className={tdClass}>能，用直标一抗时省略，牺牲部分灵敏度换省事和低背景</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>规格写法示例</td>
                    <td className={tdClass}>Rabbit anti-GAPDH（兔抗 GAPDH）</td>
                    <td className={tdClass}>Goat Anti-Rabbit IgG (H+L), HRP（山羊抗兔 IgG，HRP 偶联）</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              分不清手里是一抗还是二抗，看货号描述：写了目标蛋白名的是一抗；写了 Anti-Rabbit、Anti-Mouse 又带 HRP、FITC、Alexa Fluor 的，是二抗。
            </p>

            {/* H2 种属搭配 */}
            <h2 id="species-matching" className={h2Class}>种属搭配：怎么按一抗选二抗</h2>
            <p className={bodyClass}>
              选二抗的核心规则只有一条：二抗要能认一抗，二抗自己的宿主又要和一抗、样本都不同。
            </p>

            <h3 className={h3Class}>三步原则：先看一抗宿主，再看亚型，最后定标记</h3>
            <p className={bodyClass}>
              第一步看宿主：兔源一抗买抗兔二抗，鼠源买抗鼠，山羊源买抗山羊。第二步看亚型：一抗是小鼠 IgG1，二抗可以写抗小鼠 IgG (H+L)，要求严就直接写抗小鼠 IgG1；IgM 一抗必须配抗 IgM 二抗。第三步定标记：WB 默认 HRP 配 ECL，IF 和流式按仪器通道选荧光染料，逐项展开见下文按实验一节。
            </p>

            <h3 className={h3Class}>种属搭配表</h3>
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>一抗宿主</th>
                    <th className={thClass}>一抗常见类型</th>
                    <th className={thClass}>推荐二抗写法</th>
                    <th className={thClass}>要避开的二抗宿主</th>
                    <th className={thClass}>备注</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>兔</td>
                    <td className={tdClass}>兔多抗、兔单抗（IgG）</td>
                    <td className={tdClass}>山羊抗兔 IgG (H+L)；驴抗兔 IgG (H+L)</td>
                    <td className={tdClass}>兔源</td>
                    <td className={tdClass}>多标优先驴源预吸附款</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>小鼠</td>
                    <td className={tdClass}>小鼠单抗（IgG1、IgG2a 等亚型）、IgM</td>
                    <td className={tdClass}>山羊抗小鼠 IgG (H+L)；亚型特异的抗小鼠 IgG1</td>
                    <td className={tdClass}>小鼠源</td>
                    <td className={tdClass}>染鼠组织时换宿主，或用 MOM 封闭试剂处理内源 IgG</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>大鼠</td>
                    <td className={tdClass}>大鼠单抗（IgG1、IgG2a 等亚型）</td>
                    <td className={tdClass}>山羊抗大鼠 IgG；兔抗大鼠 IgG</td>
                    <td className={tdClass}>大鼠源</td>
                    <td className={tdClass}>常与小鼠单抗搭档做双标</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>山羊</td>
                    <td className={tdClass}>山羊多抗（IgG）</td>
                    <td className={tdClass}>驴抗山羊 IgG (H+L)；兔抗山羊 IgG</td>
                    <td className={tdClass}>山羊源</td>
                    <td className={tdClass}>山羊源一抗相对少见，先确认二抗有对应抗性</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>鸡</td>
                    <td className={tdClass}>鸡多抗（IgY）</td>
                    <td className={tdClass}>抗鸡 IgY 二抗</td>
                    <td className={tdClass}>鸡源</td>
                    <td className={tdClass}>注意是 IgY 不是 IgG，抗哺乳动物二抗不识别</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className={h3Class}>决策树：三个问题决定用什么二抗</h3>
            <p className={bodyClass}>按顺序问自己三个问题，能覆盖绝大多数选型情况：</p>
            <ol className="mt-3 space-y-3 text-[15px] leading-7 text-slate-700 dark:text-slate-300">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-500/25 dark:text-brand-300">
                  1
                </span>
                <span>
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">样本和一抗同种属吗？</strong>
                  比如鼠单抗染鼠组织——抗鼠二抗会把组织里的内源小鼠 IgG 一起识别，背景一片高。三条路：换不同宿主的一抗；用 MOM（Mouse on Mouse）封闭试剂或 Fab 片段二抗处理内源 IgG；或者直接用直标一抗，不上二抗。一般封闭用二抗宿主的正常血清，别用样本同种属的血清——那等于再加一遍 IgG。
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-500/25 dark:text-brand-300">
                  2
                </span>
                <span>
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">要做双标或多标吗？</strong>
                  各个一抗的宿主必须不同（兔 + 鼠是经典组合），二抗尽量选同一宿主（比如都用驴源）的预吸附款，把对其他物种的交叉反应性吸附掉。
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-500/25 dark:text-brand-300">
                  3
                </span>
                <span>
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">靶蛋白丰度低、信号上不来？</strong>
                  先换生物素-亲和素扩增系统或更高灵敏度的底物，再考虑延长孵育——浓度和背景是一对矛盾，别只加量。
                </span>
              </li>
            </ol>

            {/* 中段 CTA */}
            <div className={`mt-8 rounded-lg p-5 ${uiSurfaces.panelStrong}`}>
              <p className="text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                已确定一抗宿主？去
                <Link href={catalogHref('二抗')} className={`mx-1 ${linkClass}`}>二抗目录</Link>
                按宿主和标记筛选；也可以直接把一抗货号贴进快速下单，我们配好二抗再回复。
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setShowQuickOrder(true)} className={CTA_BUTTON_CLASS}>
                  <ShoppingCart size={16} />
                  打开快速下单，按货号配二抗
                </button>
                <Link href={catalogHref('二抗')} className={uiSurfaces.linkButton}>
                  浏览二抗目录
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>

            {/* H2 按实验类型选二抗 */}
            <h2 className={h2Class}>按实验类型选二抗</h2>
            <p className={bodyClass}>
              标记怎么选主要由读出方式决定：显色走 HRP 或 AP，荧光看仪器通道，ELISA 两种都常见。
            </p>
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>实验</th>
                    <th className={thClass}>常用二抗标记</th>
                    <th className={thClass}>关键注意</th>
                    <th className={thClass}>站内指南</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>WB</td>
                    <td className={tdClass}>HRP（配 ECL 底物）</td>
                    <td className={tdClass}>封闭和洗涤要充分，背景高多半是这两步的问题</td>
                    <td className={tdClass}>
                      <Link href="/protocols/western-blot" className={linkClass}>WB 实验指南</Link>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>IHC</td>
                    <td className={tdClass}>HRP（DAB 显色）或 AP</td>
                    <td className={tdClass}>先封闭内源性过氧化物酶，否则组织自身酶活会显背景</td>
                    <td className={tdClass}>
                      <Link href="/protocols/ihc" className={linkClass}>IHC 实验指南</Link>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>IF / ICC</td>
                    <td className={tdClass}>荧光染料（Alexa Fluor、FITC、Cy3/Cy5）</td>
                    <td className={tdClass}>染料激发/发射峰对上显微镜激光和滤片组，多标防串色</td>
                    <td className={tdClass}>
                      <Link href="/protocols/immunofluorescence" className={linkClass}>免疫荧光指南</Link>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>流式</td>
                    <td className={tdClass}>荧光染料（FITC、PE、APC 等）</td>
                    <td className={tdClass}>按仪器激光配置选染料，记得做同型对照</td>
                    <td className={tdClass}>
                      <Link href="/protocols/flow-cytometry" className={linkClass}>流式实验指南</Link>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>ELISA</td>
                    <td className={tdClass}>HRP（TMB 显色）或 AP</td>
                    <td className={tdClass}>二抗物种与捕获抗体、样本匹配，避免结合捕获抗体造成假信号</td>
                    <td className={tdClass}>
                      <Link href="/protocols/elisa-sandwich" className={linkClass}>夹心 ELISA 指南</Link>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>IP / Co-IP</td>
                    <td className={tdClass}>HRP 或荧光</td>
                    <td className={tdClass}>二抗会同时识别用于 IP 的一抗，轻重链条带可能遮挡目标条带</td>
                    <td className={tdClass}>
                      <Link href="/protocols/coip" className={linkClass}>Co-IP 指南</Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className={h3Class}>WB</h3>
            <p className={bodyClass}>
              WB 是二抗用量最大的场景，HRP 二抗配 ECL 底物是默认组合。孵育完把膜洗干净比加量更管用——背景高，先查封闭和洗涤，再怀疑二抗，这两步出问题比买错二抗更常见。磷酸化蛋白检测建议用 BSA 封闭，少用脱脂牛奶。选型可以看
              <Link href={catalogHref('一抗', 'WB抗体')} className={`mx-1 ${linkClass}`}>WB 抗体</Link>
              目录，完整流程见
              <Link href="/scenes/western-blot" className={`mx-1 ${linkClass}`}>WB 场景页</Link>。
            </p>

            <h3 className={h3Class}>IHC</h3>
            <p className={bodyClass}>
              IHC 分化学显色（HRP-DAB）和免疫荧光两条路线，二抗分别配偶联酶或荧光染料。显色前务必封闭内源性过氧化物酶，不然组织自己的酶活会把 DAB 显出来，背景深到看不出结构。相关抗体看
              <Link href={catalogHref('一抗', 'IHC和成像抗体')} className={`mx-1 ${linkClass}`}>IHC 和成像抗体</Link>
              目录，场景页见
              <Link href="/scenes/ihc" className={`mx-1 ${linkClass}`}>IHC 场景</Link>；背景问题可以对照
              <Link href="/discoveries/008-ihc-background-troubleshooting" className={`mx-1 ${linkClass}`}>IHC 背景排查清单</Link>。
            </p>

            <h3 className={h3Class}>IF / ICC</h3>
            <p className={bodyClass}>
              IF 的标记选择本质是通道规划：二抗染料的激发峰要对上显微镜激光，发射峰要避开其他通道，多标实验先把通道表画好再买抗体。宽场和共聚焦的滤片组不同，下单前确认仪器配置。完整流程见
              <Link href="/protocols/immunofluorescence" className={`mx-1 ${linkClass}`}>免疫荧光指南</Link>
              和
              <Link href="/scenes/immunofluorescence" className={`mx-1 ${linkClass}`}>IF 场景页</Link>。
            </p>

            <h3 className={h3Class}>流式</h3>
            <p className={bodyClass}>
              流式按仪器激光配置选染料，488 激光配 FITC、PE，640 配 APC 是常见组合，具体以机器型号为准。别忘了同型对照（isotype control），它是设门和判断背景的标尺，panel 里要给它留位置。抗体看
              <Link href={catalogHref('一抗', '流式抗体')} className={`mx-1 ${linkClass}`}>流式抗体</Link>
              和
              <Link href={catalogHref('一抗', '同型对照抗体')} className={`mx-1 ${linkClass}`}>同型对照抗体</Link>
              目录，流程见
              <Link href="/protocols/flow-cytometry" className={`mx-1 ${linkClass}`}>流式指南</Link>
              与
              <Link href="/scenes/flow-cytometry" className={`mx-1 ${linkClass}`}>流式场景页</Link>。
            </p>

            <h3 className={h3Class}>ELISA</h3>
            <p className={bodyClass}>
              ELISA 里二抗通常就是检测抗体，物种要和捕获抗体、样本匹配，别让二抗结合到捕获抗体上造成假信号。HRP 配 TMB 是最常见的读出组合。完整流程见
              <Link href="/protocols/elisa-sandwich" className={`mx-1 ${linkClass}`}>夹心 ELISA 指南</Link>
              和
              <Link href="/scenes/elisa" className={`mx-1 ${linkClass}`}>ELISA 场景页</Link>。
            </p>

            {/* H2 常见搭配错误 */}
            <h2 className={h2Class}>常见搭配错误</h2>
            <p className={bodyClass}>
              下面七条基本覆盖了日常咨询里的大多数问题，每条都按「错误 → 后果 → 正确做法」排好。
            </p>
            <ol className="mt-4 space-y-5">
              {[
                {
                  title: '一抗宿主和二抗抗性对不上',
                  wrong: '鼠源一抗配了抗兔二抗。',
                  result: '孵育做完没有信号，或者弱到怀疑人生。',
                  fix: '按一抗宿主选二抗，下单前核对一抗货号里的宿主信息——Anti- 后面那个词，就是二抗要抗的对象。',
                },
                {
                  title: '一抗宿主和样本同种属',
                  wrong: '鼠单抗染鼠组织。',
                  result: '抗鼠二抗除了结合你加的一抗，还会识别组织里的内源小鼠 IgG，背景一片高，靶点全被盖住。',
                  fix: '换不同宿主的一抗；用 MOM（Mouse on Mouse）封闭试剂或 Fab 片段二抗处理内源 IgG；也可以改用直标一抗，不用二抗。',
                },
                {
                  title: '多标时两个一抗用了同一宿主',
                  wrong: '兔一抗加兔一抗做双标。',
                  result: '二抗分不清信号来源，两个通道一起亮。',
                  fix: '一抗选不同宿主（兔 + 鼠是经典组合），二抗统一用预吸附款。',
                },
                {
                  title: '直标一抗又加了一遍二抗',
                  wrong: '直标一抗孵育完，按间接法又加了二抗。',
                  result: '步骤变长、背景抬高，直标省事的优势没了。',
                  fix: '直标一抗孵育完直接读数，不要再叠二抗。',
                },
                {
                  title: '忽略一抗亚型',
                  wrong: 'IgM 一抗配了只抗 IgG 的二抗。',
                  result: '二抗识别不了 μ 链，信号不稳定或干脆没有。',
                  fix: '看一抗说明书的亚型；IgM 一抗必须配抗 IgM 二抗，IgG 亚型特异的实验选对应亚型抗体。',
                },
                {
                  title: '荧光二抗和仪器通道不匹配',
                  wrong: '买了仪器没有对应激光的荧光二抗。',
                  result: '该亮的通道不亮，钱白花。',
                  fix: '按显微镜激光/滤片组或流式仪配置选染料，多标提前画通道表。',
                },
                {
                  title: '稀释比例照搬别家 protocol',
                  wrong: '直接套用其他实验室的稀释度。',
                  result: '背景高或没信号，两头踩坑。',
                  fix: '以产品说明书为起点做梯度预实验，一抗二抗分开优化。',
                },
              ].map((item, index) => (
                <li key={item.title} className="flex gap-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    {index + 1}
                  </span>
                  <div className="text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                    <p className="mt-1">
                      <span className="font-medium text-rose-600 dark:text-rose-400">错误</span>
                      ：{item.wrong}
                      <span className="font-medium text-rose-600 dark:text-rose-400">后果</span>
                      ：{item.result}
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">正确做法</span>
                      ：{item.fix}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {/* H2 标记与稀释 */}
            <h2 className={h2Class}>选二抗时看标记与稀释</h2>

            <h3 className={h3Class}>标记怎么选</h3>
            <p className={bodyClass}>
              HRP 配 ECL 是 WB 的默认答案；AP 显色背景低、片子也更耐放，适合要留存的膜。生物素-亲和素系统灵敏度高，适合低丰度靶蛋白，但封闭液不能含生物素，脱脂牛奶不行。荧光染料没有「最好」，只有「对不对得上通道」：激发峰对上激光、发射峰避开邻居，多标先画通道表再下单。
            </p>

            <h3 className={h3Class}>稀释比例和孵育时间</h3>
            <p className={bodyClass}>
              二抗没有通用稀释比例，说明书给的推荐范围只是起点——样本类型、靶蛋白丰度、封闭效果都会影响最佳浓度。常见做法是按说明书中间值起步，上下各做一档梯度，一抗二抗分开优化，谁的问题谁背。孵育时间同理，室温一两小时或 4℃ 过夜都有人用，以说明书为准。稀释和封闭用的缓冲液，可以参考站内的
              <Link href="/protocols/buffers/blocking-buffer" className={`mx-1 ${linkClass}`}>封闭液</Link>、
              <Link href="/protocols/buffers/tbst" className={`mx-1 ${linkClass}`}>TBST</Link>
              和
              <Link href="/protocols/buffers/pbst" className={`mx-1 ${linkClass}`}>PBST</Link>
              配方。
            </p>
            <div className={tableWrapClass}>
              <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                <thead>
                  <tr>
                    <th className={thClass}>实验</th>
                    <th className={thClass}>二抗常见起始范围（仅供参考）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>WB（HRP-ECL）</td>
                    <td className={tdClass}>1:1,000 – 1:10,000</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>IHC</td>
                    <td className={tdClass}>1:100 – 1:500</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>IF / ICC</td>
                    <td className={tdClass}>1:100 – 1:500</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>流式</td>
                    <td className={tdClass}>1:50 – 1:200</td>
                  </tr>
                  <tr>
                    <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>ELISA（HRP-TMB）</td>
                    <td className={tdClass}>1:1,000 – 1:5,000</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              以上为常见起始范围，不是通用标准；务必以产品说明书为起点做梯度预实验。
            </p>

            {/* H2 核对清单 */}
            <h2 id="checklist" className={h2Class}>下单前核对清单</h2>
            <p className={bodyClass}>
              提交询价前，把这八项对着货号过一遍，能少很多来回确认的时间。
            </p>
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={`${thClass} w-10`}>
                      <span className="sr-only">核对</span>
                    </th>
                    <th className={thClass}>核对项</th>
                    <th className={thClass}>看什么</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { item: '一抗宿主', detail: '货号或说明书里的 Host 字段，Anti- 后面的物种名' },
                    { item: '一抗亚型', detail: '单抗的 IgG 亚类或 IgM；多抗一般 (H+L) 即可覆盖' },
                    { item: '二抗抗性', detail: '与一抗宿主一致：兔一抗配抗兔，鼠一抗配抗鼠' },
                    { item: '二抗宿主', detail: '与一抗、样本都不同；染同种属组织时重点检查' },
                    { item: '标记类型', detail: 'HRP、AP、荧光染料或生物素，对应用实验和仪器' },
                    { item: '应用验证', detail: '二抗是否标注了你的实验类型（WB、IHC、IF、流式）' },
                    { item: '交叉吸附', detail: '多标实验选预吸附二抗，看吸附谱覆盖哪些物种' },
                    { item: '规格与物种反应性', detail: '体积/浓度，以及是否反应你的样本物种' },
                  ].map((row) => (
                    <tr key={row.item}>
                      <td className={`${tdClass} text-center`}>
                        <Square size={15} className="mx-auto text-slate-400 dark:text-slate-500" />
                      </td>
                      <td className={`${tdClass} font-medium text-slate-900 dark:text-slate-100`}>{row.item}</td>
                      <td className={tdClass}>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              核对完就可以通过快速下单提交，我们会按一抗货号帮你把二抗配齐。
            </p>

            {/* H2 FAQ */}
            <h2 id="faq" className={h2Class}>常见问题</h2>
            <div className="mt-4 space-y-6">
              {primaryVsSecondaryAntibodyFaqs.map((faq) => (
                <div key={faq.q}>
                  <h3 className="flex items-start gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                    <BookOpenText size={17} className="mt-1 flex-shrink-0 text-brand-600 dark:text-brand-400" />
                    {faq.q}
                  </h3>
                  <p className="mt-2 text-[15px] leading-7 text-slate-700 dark:text-slate-300">{faq.a}</p>
                </div>
              ))}
            </div>

            {/* 文末 CTA */}
            <div className={`mt-12 rounded-lg p-6 text-center ${uiSurfaces.panelStrong}`}>
              <p className="text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                需要按一抗货号配二抗，或者要批量、课题组报价？点「快速下单」提交，我们的技术团队会核对宿主、亚型和应用后回复。
              </p>
              <button
                type="button"
                onClick={() => setShowQuickOrder(true)}
                className={`${CTA_BUTTON_CLASS} mt-4`}
              >
                <ShoppingCart size={16} />
                打开快速下单
              </button>
            </div>

            {/* 相关阅读与文末信息 */}
            <div className="mt-10 border-t border-slate-200/70 pt-6 dark:border-slate-700/60">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <ClipboardList size={17} className="text-brand-600 dark:text-brand-400" />
                相关阅读
              </h2>
              <ul className="mt-3 space-y-2 text-[15px]">
                <li className="flex items-start gap-2">
                  <Microscope size={16} className="mt-1 flex-shrink-0 text-slate-400" />
                  <Link href="/discoveries/008-ihc-background-troubleshooting" className={linkClass}>
                    IHC 染色背景脏？排查清单
                  </Link>
                </li>
                <li className="flex items-start gap-2">
                  <FlaskConical size={16} className="mt-1 flex-shrink-0 text-slate-400" />
                  <Link href="/discoveries/004-antibody-storage-myths" className={linkClass}>
                    抗体保存的六个误区，第三个几乎人人都踩过
                  </Link>
                </li>
              </ul>
              <p className="mt-6 text-xs leading-6 text-slate-500 dark:text-slate-400">
                本文仅供科研使用，不用于临床诊断。更新日期：2026 年 10 月 19 日。
              </p>
            </div>
          </div>
        </article>
      </main>

      <SiteFooter />
      <MobileBottomNav />
      {showQuickOrder && <QuickOrderModal onClose={() => setShowQuickOrder(false)} />}
    </div>
  );
}
