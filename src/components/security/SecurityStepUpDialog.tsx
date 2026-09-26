'use client';

import { useEffect, useState } from 'react';
import { Mail, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

type StepUpMethod = 'totp' | 'sms' | 'email';
type StepUpAction = 'password_change' | 'password_setup' | 'passkey_add' | 'passkey_delete' | 'mfa_disable' | 'recovery_codes' | 'security_session_revoke' | 'security_device_remove' | 'admin_mfa_policy' | 'admin_sensitive' | 'organization_permissions';

type Props = {
  open: boolean;
  action: StepUpAction;
  title: string;
  description: string;
  onCancel: () => void;
  onVerified: (grantToken: string) => void;
};

type Availability = { methods: StepUpMethod[]; preferredMethod: StepUpMethod | null };

export default function SecurityStepUpDialog({ open, action, title, description, onCancel, onVerified }: Props) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [method, setMethod] = useState<StepUpMethod>('totp');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChallengeId('');
    setCode('');
    setError('');
    setAvailability(null);
    void fetch('/api/auth/security/step-up', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as Availability & { error?: string } | null;
        if (!response.ok) throw new Error(data?.error || '可用的验证方式暂时无法读取');
        const methods = Array.isArray(data?.methods) ? data.methods : [];
        const preferredMethod = data?.preferredMethod && methods.includes(data.preferredMethod) ? data.preferredMethod : methods[0] ?? null;
        setAvailability({ methods, preferredMethod });
        if (preferredMethod) setMethod(preferredMethod);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '可用的验证方式暂时无法读取'));
  }, [open]);

  if (!open) return null;

  const methodLabel = method === 'totp' ? '验证器应用中的验证码' : method === 'sms' ? '短信验证码' : '邮箱验证码';
  const safeMethods = availability?.methods ?? [];
  const begin = async () => {
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/auth/security/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, method }),
      });
      const data = await response.json().catch(() => null) as { challengeId?: string; error?: string } | null;
      if (!response.ok || !data?.challengeId) throw new Error(data?.error || '无法开始身份验证');
      setChallengeId(data.challengeId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始身份验证');
    } finally {
      setWorking(false);
    }
  };

  const verify = async () => {
    if (!challengeId || !/^\d{6}$/.test(code)) {
      setError('请输入 6 位验证码。');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/auth/security/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, method, challengeId, code }),
      });
      const data = await response.json().catch(() => null) as { grantToken?: string; error?: string } | null;
      if (!response.ok || !data?.grantToken) throw new Error(data?.error || '身份验证失败');
      onVerified(data.grantToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '身份验证失败');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-site-overlay flex items-end justify-center overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(var(--site-header-height)+var(--site-header-gap)+1rem)] sm:items-center sm:p-6 ${uiSurfaces.modalBackdrop}`} role="presentation">
      <button type="button" aria-label="关闭验证窗口" className="absolute inset-0 cursor-default" onClick={onCancel} />
      <div className={`relative z-10 w-full max-w-md overflow-hidden rounded-t-[var(--brand-border-radius-lg)] sm:rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal}`} role="dialog" aria-modal="true" aria-labelledby="security-step-up-title" aria-describedby="security-step-up-description">
        <div className="flex items-start gap-3 border-b border-[var(--brand-color-border)] px-5 py-4 sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-info-bg)] text-[var(--brand-color-info-text)]" aria-hidden="true"><ShieldCheck size={19} /></div>
          <div className="min-w-0 flex-1">
            <h2 id="security-step-up-title" className={`text-base font-semibold ${uiSurfaces.titleText}`}>{title}</h2>
            <p id="security-step-up-description" className={`mt-1 text-sm leading-6 ${uiSurfaces.textSecondary}`}>{description}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={working} className={`rounded-full p-2 ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing} disabled:opacity-50`} aria-label="关闭验证窗口"><X size={18} /></button>
        </div>
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          {!availability ? (error ? <p className={uiSurfaces.statusError} role="alert">{error}</p> : <p className={`text-sm ${uiSurfaces.textSecondary}`}>正在读取可用验证方式…</p>) : safeMethods.length === 0 ? <p className={uiSurfaces.statusError}>尚未设置可用的验证方式。请先验证手机或邮箱，或在账户安全中设置验证器应用。</p> : (
            <>
              <label htmlFor="security-step-up-method" className={`block text-sm font-semibold ${uiSurfaces.titleText}`}>验证方式</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {safeMethods.map((item) => (
                  <button key={item} type="button" onClick={() => { setMethod(item); setChallengeId(''); setCode(''); setError(''); }} className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-medium ${method === item ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-[var(--brand-color-border)] bg-transparent text-[var(--brand-color-text-secondary)]'}`}>
                    {item === 'totp' ? <ShieldCheck size={15} /> : item === 'sms' ? <MessageSquare size={15} /> : <Mail size={15} />}{item === 'totp' ? '验证器应用' : item === 'sms' ? '手机短信' : '邮箱验证码'}
                  </button>
                ))}
              </div>
              {method === 'totp' && <p className={`mt-2 text-xs ${uiSurfaces.textSecondary}`}>建议优先使用验证器应用。</p>}
              {!challengeId ? (
                <button type="button" onClick={() => void begin()} disabled={working} className={`mt-5 w-full ${uiSurfaces.primaryButton} disabled:opacity-60`}>{working ? '准备中…' : method === 'totp' ? '开始验证' : `发送${methodLabel}`}</button>
              ) : (
                <>
                  <label htmlFor="security-step-up-code" className={`mt-5 block text-sm font-semibold ${uiSurfaces.titleText}`}>{methodLabel}</label>
                  <input id="security-step-up-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="输入 6 位验证码" className={`mt-2 w-full px-3 py-3 text-center text-lg font-semibold tracking-[0.35em] ${uiSurfaces.input}`} />
                  {error && <p className={`mt-3 ${uiSurfaces.statusError}`} role="alert">{error}</p>}
                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onCancel} disabled={working} className={`w-full sm:w-auto ${uiSurfaces.button}`}>取消</button><button type="button" onClick={() => void verify()} disabled={working || code.length !== 6} className={`w-full sm:w-auto ${uiSurfaces.primaryButton} disabled:opacity-60`}>{working ? '验证中…' : '验证并继续'}</button></div>
                </>
              )}
              {!challengeId && error && <p className={`mt-3 ${uiSurfaces.statusError}`} role="alert">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
