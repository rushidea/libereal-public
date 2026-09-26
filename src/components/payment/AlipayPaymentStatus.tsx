import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, XCircle } from 'lucide-react';
import type { AlipayPaymentSummary, AlipayPaymentStatus } from '@/data/alipay-payment';
import { uiSurfaces } from '@/lib/ui-surfaces';

const STATUS_CONFIG: Record<AlipayPaymentStatus, {
  label: string;
  description: string;
  className: string;
  icon: typeof Clock3;
}> = {
  pending: {
    label: '等待付款',
    description: '订单将在付款期限结束后停止支付宝付款。',
    className: uiSurfaces.badgeWarning,
    icon: Clock3,
  },
  processing: {
    label: '付款确认中',
    description: '支付宝通知正在处理，请稍后刷新订单。',
    className: uiSurfaces.badgeInfo,
    icon: LoaderCircle,
  },
  paid: {
    label: '已付款',
    description: '支付宝付款已经确认。',
    className: uiSurfaces.badgeSuccess,
    icon: CheckCircle2,
  },
  expired: {
    label: '付款已超时',
    description: '付款入口已经关闭，订单记录继续保留。',
    className: uiSurfaces.badge,
    icon: Clock3,
  },
  closed: {
    label: '交易已关闭',
    description: '本次支付宝交易已经关闭。',
    className: uiSurfaces.badge,
    icon: XCircle,
  },
  failed: {
    label: '付款失败',
    description: '本次付款未完成，可在付款期限内重新发起。',
    className: uiSurfaces.badgeError,
    icon: AlertCircle,
  },
};

export function getAlipayPaymentStatusLabel(status: AlipayPaymentStatus) {
  return STATUS_CONFIG[status].label;
}

export default function AlipayPaymentStatusView({
  payment,
  compact = false,
  showReferences = false,
}: {
  payment: AlipayPaymentSummary;
  compact?: boolean;
  showReferences?: boolean;
}) {
  const config = STATUS_CONFIG[payment.status];
  const Icon = config.icon;

  if (compact) {
    return (
      <span className={`${config.className} gap-1.5 px-2.5 py-1 text-xs font-medium`}>
        <Icon className={`h-3.5 w-3.5 ${payment.status === 'processing' ? 'animate-spin' : ''}`} />
        {config.label}
      </span>
    );
  }

  return (
    <div className={`rounded-[var(--brand-border-radius)] p-3 text-left ${uiSurfaces.panel}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs font-medium ${uiSurfaces.mutedText}`}>支付宝状态</span>
        <span className={`${config.className} gap-1.5 px-2.5 py-1 text-xs font-medium`}>
          <Icon className={`h-3.5 w-3.5 ${payment.status === 'processing' ? 'animate-spin' : ''}`} />
          {config.label}
        </span>
      </div>
      <p className={`mt-2 text-xs leading-5 ${uiSurfaces.textSecondary}`}>{config.description}</p>
      {payment.paidAt && (
        <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>付款时间：{new Date(payment.paidAt).toLocaleString('zh-CN')}</p>
      )}
      {showReferences && (payment.outTradeNo || payment.tradeNo) && (
        <dl className={`mt-2 space-y-1 border-t pt-2 text-xs ${uiSurfaces.border}`}>
          {payment.outTradeNo && <div className="grid grid-cols-[5rem_1fr] gap-2"><dt className={uiSurfaces.mutedText}>商户订单号</dt><dd className={`break-all font-mono ${uiSurfaces.textSecondary}`}>{payment.outTradeNo}</dd></div>}
          {payment.tradeNo && <div className="grid grid-cols-[5rem_1fr] gap-2"><dt className={uiSurfaces.mutedText}>支付宝交易号</dt><dd className={`break-all font-mono ${uiSurfaces.textSecondary}`}>{payment.tradeNo}</dd></div>}
          {payment.notifiedAt && <div className="grid grid-cols-[5rem_1fr] gap-2"><dt className={uiSurfaces.mutedText}>通知时间</dt><dd className={uiSurfaces.textSecondary}>{new Date(payment.notifiedAt).toLocaleString('zh-CN')}</dd></div>}
        </dl>
      )}
    </div>
  );
}
