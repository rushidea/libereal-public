'use client';

// 运营数据图表组件集（内联 SVG，不引外部图表库）
// 与 page.tsx 内 RevenueChart/OrderStatusChart 同一套视觉语言：panel 卡片 + 手绘 SVG

import { uiSurfaces } from '@/lib/ui-surfaces';

// 双轴折线：左轴金额、右轴订单数（近 30 天）
export function DualAxisLineChart({
  data,
  className,
}: {
  data: { date: string; label: string; revenue: number; orderCount: number }[];
  className?: string;
}) {
  const W = 560;
  const H = 210;
  const PAD = { top: 20, right: 40, bottom: 28, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const pow = Math.pow(10, Math.max(Math.ceil(Math.log10(maxRevenue)), 0));
  const niceMax = maxRevenue <= 1 ? 1 : Math.ceil(maxRevenue / pow) * pow;
  const maxCount = Math.max(...data.map((d) => d.orderCount), 1);
  const niceMaxCount = maxCount <= 1 ? 1 : Math.ceil(maxCount / 2) * 2;

  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const yRev = (v: number) => PAD.top + innerH - (v / niceMax) * innerH;
  const yCount = (v: number) => PAD.top + innerH - (v / niceMaxCount) * innerH;

  const revPoints = data.map((d, i) => `${(PAD.left + i * stepX).toFixed(1)},${yRev(d.revenue).toFixed(1)}`);
  const cntPoints = data.map((d, i) => `${(PAD.left + i * stepX).toFixed(1)},${yCount(d.orderCount).toFixed(1)}`);

  const gridLines = [0, 0.5, 1].map((f) => ({ y: PAD.top + innerH - f * innerH, label: Math.round(niceMax * f) }));
  const hasData = data.some((d) => d.revenue > 0 || d.orderCount > 0);
  const labelEvery = Math.ceil(data.length / 10); // 最多显示 ~10 个日期标签

  return (
    <div className={`rounded-xl p-4 sm:rounded-2xl ${uiSurfaces.panel} ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <h3 className="text-sm font-semibold text-gray-700">近 30 天营业额 / 订单数</h3>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-0.5 rounded bg-teal-600" /> 营业额（净额）</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-0.5 rounded bg-blue-600" /> 订单数</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="近 30 天营业额与订单数双轴折线图">
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.left - 6} y={g.y + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{g.label}</text>
          </g>
        ))}
        {hasData ? (
          <>
            <polyline points={revPoints.join(' ')} fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={cntPoints.join(' ')} fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
            {data.map((d, i) => (
              <text key={d.date} x={PAD.left + i * stepX} y={H - 8} textAnchor="middle" fontSize="9" fill="#9ca3af">
                {i % labelEvery === 0 ? d.label : ''}
              </text>
            ))}
          </>
        ) : (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="#9ca3af">近 30 天暂无订单数据</text>
        )}
      </svg>
    </div>
  );
}

// 环形图：支付方式分布（近 90 天金额）
const DONUT_COLORS = ['#0d9488', '#0284c7', '#d97706', '#7c3aed', '#dc2626', '#64748b'];

export function PaymentMethodDonut({
  data,
  className,
}: {
  data: { method: string; label: string; amount: number; count: number }[];
  className?: string;
}) {
  const total = data.reduce((s, d) => s + d.amount, 0);
  const R = 44;
  const CX = 60;
  const CY = 60;
  const C = 2 * Math.PI * R;

  const arcs = data.map((d, i) => {
    const frac = total > 0 ? d.amount / total : 0;
    const dash = frac * C;
    const prior = data.slice(0, i).reduce((sum, item) => sum + (total > 0 ? item.amount / total : 0), 0);
    const offset = -prior * C;
    return { ...d, color: DONUT_COLORS[i % DONUT_COLORS.length], dash, offset };
  });

  return (
    <div className={`rounded-xl p-4 sm:rounded-2xl ${uiSurfaces.panel} ${className ?? ''}`}>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">支付方式分布（近 90 天）</h3>
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <svg viewBox="0 0 120 120" className="w-28 h-28" role="img" aria-label="支付方式分布环形图">
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
            {total > 0 && arcs.map((a) => (
              <circle
                key={a.method}
                cx={CX} cy={CY} r={R} fill="none"
                stroke={a.color} strokeWidth="16"
                strokeDasharray={`${Math.max(a.dash - 1.5, 0)} ${C - Math.max(a.dash - 1.5, 0)}`}
                strokeDashoffset={a.offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${CX} ${CY})`}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <b className="text-lg text-gray-900 leading-none">¥{(total / 10000).toFixed(1)}w</b>
            <span className="text-[10px] text-gray-500 mt-0.5">近 90 天</span>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {total === 0 && <li className="text-xs text-gray-500">近 90 天暂无支付数据</li>}
          {arcs.map((a) => (
            <li key={a.method} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
              <span className="text-gray-600 truncate">{a.label}</span>
              <span className="ml-auto font-medium text-gray-800">¥{a.amount.toLocaleString('zh-CN')}</span>
              <span className="text-[10px] text-gray-400 w-10 text-right">{total > 0 ? Math.round((a.amount / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// 漏斗图：询价转化（近 30 天）
export function InquiryFunnel({
  data,
  className,
}: {
  data: { inquiries: number; quoted: number; ordered: number; completed: number; quotedRate: number; orderedRate: number; completedRate: number };
  className?: string;
}) {
  const W = 560;
  const H = 210;
  const stages = [
    { label: '询价提交', value: data.inquiries, color: '#e6f1fb', stroke: '#0284c7' },
    { label: '已报价', value: data.quoted, color: '#e1f5ee', stroke: '#0d9488' },
    { label: '已下单', value: data.ordered, color: '#faeeda', stroke: '#d97706' },
    { label: '成交', value: data.completed, color: '#eaf3de', stroke: '#639922' },
  ];
  const maxVal = Math.max(...stages.map((s) => s.value), 1);
  const rowH = 38;
  const gap = 10;
  const startY = 24;
  const rates = [
    { label: '报价率', value: data.quotedRate },
    { label: '下单率', value: data.orderedRate },
    { label: '成交率', value: data.completedRate },
  ];

  return (
    <div className={`rounded-xl p-4 sm:rounded-2xl ${uiSurfaces.panel} ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">询价转化漏斗（近 30 天）</h3>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          {rates.map((r) => (
            <span key={r.label}>{r.label} <b className="text-gray-800">{r.value}%</b></span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="询价转化漏斗图">
        {stages.map((s, i) => {
          const width = Math.max((s.value / maxVal) * (W - 120), s.value > 0 ? 40 : 0);
          const x = (W - width) / 2;
          const y = startY + i * (rowH + gap);
          return (
            <g key={s.label}>
              <rect x={x} y={y} width={width} height={rowH} rx="6" fill={s.color} stroke={s.stroke} strokeWidth="0.5" />
              <text x={x + 10} y={y + rowH / 2 + 1} dominantBaseline="central" fontSize="12" fill="#374151">{s.label}</text>
              <text x={x + width - 10} y={y + rowH / 2 + 1} textAnchor="end" dominantBaseline="central" fontSize="12" fontWeight="500" fill="#1f2937">{s.value}</text>
            </g>
          );
        })}
        {data.inquiries === 0 && (
          <text x={W / 2} y={H - 12} textAnchor="middle" fontSize="12" fill="#9ca3af">近 30 天暂无询价数据</text>
        )}
      </svg>
    </div>
  );
}

// 条形图：待收款账期分段（逾期红色高亮）
export function ReceivableAgingBar({
  data,
  total,
  className,
}: {
  data: { key: string; label: string; amount: number; count: number }[];
  total: number;
  className?: string;
}) {
  const W = 560;
  const H = 210;
  const PAD = { top: 16, right: 16, bottom: 26, left: 88 };
  const innerW = W - PAD.left - PAD.right;
  const rowH = 26;
  const gap = 10;
  const maxVal = Math.max(...data.map((d) => d.amount), 1);
  const isOverdue = (key: string) => key.startsWith('overdue-');
  const barColor = (key: string) => (isOverdue(key) ? '#e24b4a' : '#0d9488');

  return (
    <div className={`rounded-xl p-4 sm:rounded-2xl ${uiSurfaces.panel} ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">待收款账期分布</h3>
        <span className="text-xs text-gray-500">
          待回款 <b className="text-gray-800">¥{total.toLocaleString('zh-CN')}</b>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="待收款账期分布条形图">
        {data.map((d, i) => {
          const y = PAD.top + i * (rowH + gap);
          const w = d.amount > 0 ? Math.max((d.amount / maxVal) * innerW, 2) : 0;
          return (
            <g key={d.key}>
              <text x={PAD.left - 8} y={y + rowH / 2 + 1} textAnchor="end" dominantBaseline="central" fontSize="11" fill="#6b7280">{d.label}</text>
              <rect x={PAD.left} y={y} width={w} height={rowH} rx="5" fill={barColor(d.key)} opacity={d.amount > 0 ? 1 : 0.15} />
              {d.amount > 0 ? (
                <text x={PAD.left + w + 8} y={y + rowH / 2 + 1} dominantBaseline="central" fontSize="11" fontWeight="500" fill="#1f2937">
                  ¥{d.amount.toLocaleString('zh-CN')}
                  <tspan fontSize="10" fill="#9ca3af">（{d.count} 笔）</tspan>
                </text>
              ) : (
                <text x={PAD.left + 8} y={y + rowH / 2 + 1} dominantBaseline="central" fontSize="11" fill="#c0c0c0">—</text>
              )}
            </g>
          );
        })}
        {total === 0 && (
          <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="#9ca3af">暂无待收款</text>
        )}
      </svg>
    </div>
  );
}
