'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';
import { startRegistration } from '@simplewebauthn/browser';
import { signOut } from 'next-auth/react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import AccountSidebar from '@/components/account/AccountSidebar';
import Breadcrumb from '@/components/Breadcrumb';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { uiSurfaces } from '@/lib/ui-surfaces';
import SecurityStepUpDialog from '@/components/security/SecurityStepUpDialog';

type MfaStatus = {
  enabled: boolean;
  confirmedAt: string | null;
  lastVerifiedAt: string | null;
  passkeyEnabled?: boolean;
};

type SetupData = {
  secret: string;
  otpauthUrl: string;
};

type PasskeySummary = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

type SecuritySession = {
  id: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string | null;
  current: boolean;
  device: {
    id: string;
    name: string | null;
    browser: string | null;
    operatingSystem: string | null;
    ip: string | null;
    lastSeenAt: string;
    createdAt: string;
  } | null;
};

type SecurityDevice = {
  id: string;
  name: string | null;
  browser: string | null;
  operatingSystem: string | null;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  sessionCount: number;
};

type SecurityEvent = {
  id: string;
  eventType: string;
  ip: string | null;
  device: string | null;
  metadata: Record<string, string>;
  createdAt: string;
};

type SecurityActivityRow = {
  id: string;
  label: string;
  occurredAt: string;
  ip: string | null;
  device: string;
  detail: string;
  session?: SecuritySession;
};

type SecurityStepUpAction = 'security_session_revoke' | 'security_device_remove';
type SecurityActionInput = {
  url: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, string>;
  stepUpAction?: SecurityStepUpAction;
};
type PendingSecurityAction = {
  input: SecurityActionInput;
  successText: string;
  onSuccess?: (response: Response) => Promise<void> | void;
};

type Message = { type: 'success' | 'error'; text: string } | null;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function AccountSecurityPage() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [mfaAvailable, setMfaAvailable] = useState(true);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [setupPassword, setSetupPassword] = useState('');
  const [code, setCode] = useState('');
  const [setupError, setSetupError] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [qrCodeError, setQrCodeError] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState('');
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [passkeyWorking, setPasskeyWorking] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [passkeyNameDraft, setPasskeyNameDraft] = useState('');
  const [stepUpAction, setStepUpAction] = useState<'passkey_add' | 'passkey_delete' | 'mfa_disable' | 'recovery_codes' | SecurityStepUpAction | null>(null);
  const [pendingPasskeyDeletion, setPendingPasskeyDeletion] = useState<PasskeySummary | null>(null);
  const pendingSecurityActionRef = useRef<PendingSecurityAction | null>(null);
  const [securitySessions, setSecuritySessions] = useState<SecuritySession[]>([]);
  const [securityDevices, setSecurityDevices] = useState<SecurityDevice[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securityWorking, setSecurityWorking] = useState(false);

  const readError = useCallback(async (response: Response, fallback: string): Promise<string> => {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    if (response.status === 403 && data?.error === 'Password confirmation required') return '首次设置需要输入当前账户密码。';
    if (response.status === 403) return '此操作需要再次确认身份，请重新验证后再试。';
    if (response.status === 409 && data?.error === '至少需要保留一个验证器') return '至少需要保留一个验证器。';
    if (response.status === 404 && data?.error === 'Not found') return '双因素认证功能当前未开放。';
    return data?.error || fallback;
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/mfa/status', { cache: 'no-store' });
      if (response.status === 404) {
        setMfaAvailable(false);
        setStatus({ enabled: false, confirmedAt: null, lastVerifiedAt: null, passkeyEnabled: false });
        return;
      }
      if (!response.ok) throw new Error(await readError(response, '无法读取双因素认证状态'));
      setMfaAvailable(true);
      setStatus(await response.json() as MfaStatus);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法读取双因素认证状态' });
    } finally {
      setLoading(false);
    }
  }, [readError]);

  const loadPasskeys = useCallback(async () => {
    try {
      const response = await fetch('/api/authenticator/passkey', { cache: 'no-store' });
      if (!response.ok) throw new Error(await readError(response, '无法读取通行密钥状态'));
      const data = await response.json() as { enabled?: boolean; passkeys?: PasskeySummary[] };
      setPasskeyEnabled(data.enabled === true);
      setPasskeys(data.passkeys ?? []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法读取通行密钥状态' });
    }
  }, [readError]);

  const loadSecurityCenter = useCallback(async () => {
    setSecurityLoading(true);
    try {
      const [sessionsResponse, devicesResponse, eventsResponse] = await Promise.all([
        fetch('/api/account/security/sessions', { cache: 'no-store' }),
        fetch('/api/account/security/devices', { cache: 'no-store' }),
        fetch('/api/account/security/events', { cache: 'no-store' }),
      ]);
      if (!sessionsResponse.ok) throw new Error(await readError(sessionsResponse, '无法读取会话列表'));
      if (!devicesResponse.ok) throw new Error(await readError(devicesResponse, '无法读取设备列表'));
      if (!eventsResponse.ok) throw new Error(await readError(eventsResponse, '无法读取安全活动'));
      const [sessions, devices, events] = await Promise.all([
        sessionsResponse.json() as Promise<{ sessions: SecuritySession[] }>,
        devicesResponse.json() as Promise<{ devices: SecurityDevice[] }>,
        eventsResponse.json() as Promise<{ events: SecurityEvent[] }>,
      ]);
      setSecuritySessions(sessions.sessions ?? []);
      setSecurityDevices(devices.devices ?? []);
      setSecurityEvents(events.events ?? []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法读取安全中心数据' });
    } finally {
      setSecurityLoading(false);
    }
  }, [readError]);

  useEffect(() => {
    void loadStatus();
    void loadPasskeys();
    void loadSecurityCenter();
  }, [loadPasskeys, loadSecurityCenter, loadStatus]);

  useEffect(() => {
    let cancelled = false;
    setQrCodeUrl('');
    setQrCodeError(false);
    if (!setup?.otpauthUrl) return () => { cancelled = true; };

    void QRCode.toDataURL(setup.otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: { dark: '#111827', light: '#ffffff' },
    }).then((dataUrl) => {
      if (!cancelled) setQrCodeUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setQrCodeError(true);
    });

    return () => { cancelled = true; };
  }, [setup?.otpauthUrl]);

  async function startSetup() {
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: setupPassword }),
      });
      if (!response.ok) throw new Error(await readError(response, '无法开始双因素认证设置'));
      setSetup(await response.json() as SetupData);
      setCode('');
      setSetupError('');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法开始双因素认证设置' });
    } finally {
      setWorking(false);
    }
  }

  async function confirmSetup() {
    if (!/^\d{6}$/.test(code)) {
      setSetupError('请输入验证器显示的 6 位验证码。');
      return;
    }
    setWorking(true);
    setSetupError('');
    setMessage(null);
    try {
      const response = await fetch('/api/auth/mfa/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error(await readError(response, '双因素认证确认失败'));
      const data = await response.json() as { recoveryCodes: string[] };
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
      setSetupError('');
      setStatus({ enabled: true, confirmedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString(), passkeyEnabled: status?.passkeyEnabled ?? false });
      setMessage({ type: 'success', text: '双因素认证已启用，请立即保存恢复码。' });
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : '双因素认证确认失败');
    } finally {
      setWorking(false);
    }
  }

  async function regenerateRecoveryCodes(stepUpToken?: string) {
    if (!stepUpToken) {
      setStepUpAction('recovery_codes');
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/mfa/recovery-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepUpToken }) });
      if (!response.ok) throw new Error(await readError(response, '恢复码生成失败'));
      const data = await response.json() as { recoveryCodes: string[] };
      setRecoveryCodes(data.recoveryCodes);
      setMessage({ type: 'success', text: '新恢复码已生成，旧恢复码已全部失效。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '恢复码生成失败' });
    } finally {
      setWorking(false);
    }
  }

  async function disableMfa(stepUpToken?: string) {
    if (!stepUpToken) {
      if (!window.confirm('确定关闭双因素认证吗？关闭后，恢复码也会立即失效。')) return;
      setStepUpAction('mfa_disable');
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/mfa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepUpToken }) });
      if (!response.ok) throw new Error(await readError(response, '关闭双因素认证失败'));
      setStatus({ enabled: false, confirmedAt: null, lastVerifiedAt: null });
      setRecoveryCodes([]);
      setMessage({ type: 'success', text: '双因素认证已关闭。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '关闭双因素认证失败' });
    } finally {
      setWorking(false);
    }
  }

  async function registerPasskey(stepUpToken?: string) {
    if (!stepUpToken) {
      setStepUpAction('passkey_add');
      return;
    }
    setPasskeyWorking(true);
    setMessage(null);
    try {
      const optionsResponse = await fetch('/api/authenticator/passkey/register/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepUpToken }) });
      const optionsBody = await optionsResponse.json().catch(() => null) as { error?: string } | null;
      if (!optionsResponse.ok) throw new Error(optionsBody?.error || '无法开始添加通行密钥');
      const creation = await startRegistration({
        optionsJSON: optionsBody as Parameters<typeof startRegistration>[0]['optionsJSON'],
      });
      const verifyResponse = await fetch('/api/authenticator/passkey/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: creation, name: '本机通行密钥', stepUpToken }),
      });
      const verifyBody = await verifyResponse.json().catch(() => null) as { error?: string } | null;
      if (!verifyResponse.ok) throw new Error(verifyBody?.error || '通行密钥添加失败');
      setMessage({ type: 'success', text: '通行密钥已添加。' });
      await loadPasskeys();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '通行密钥添加失败' });
    } finally {
      setPasskeyWorking(false);
    }
  }

  async function removePasskey(passkey: PasskeySummary, stepUpToken?: string) {
      if (!stepUpToken) {
      if (!window.confirm(`确定删除“${passkey.name || '通行密钥'}”吗？`)) return;
      setPendingPasskeyDeletion(passkey);
      setStepUpAction('passkey_delete');
      return;
    }
    setPasskeyWorking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/authenticator/passkey/${encodeURIComponent(passkey.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepUpToken }) });
      if (!response.ok) throw new Error(await readError(response, '通行密钥删除失败'));
      setMessage({ type: 'success', text: '通行密钥已删除。' });
      await loadPasskeys();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '通行密钥删除失败' });
    } finally {
      setPasskeyWorking(false);
    }
  }

  function beginRenamePasskey(passkey: PasskeySummary) {
    setEditingPasskeyId(passkey.id);
    setPasskeyNameDraft(passkey.name || '');
  }

  function cancelRenamePasskey() {
    setEditingPasskeyId(null);
    setPasskeyNameDraft('');
  }

  async function savePasskeyName(passkey: PasskeySummary) {
    const name = passkeyNameDraft.trim();
    if (!name || name.length > 80) {
      setMessage({ type: 'error', text: '请输入 1 至 80 个字符的通行密钥名称。' });
      return;
    }
    setPasskeyWorking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/authenticator/passkey/${encodeURIComponent(passkey.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await readError(response, '通行密钥名称修改失败'));
      cancelRenamePasskey();
      setMessage({ type: 'success', text: '通行密钥名称已修改。' });
      await loadPasskeys();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '通行密钥名称修改失败' });
    } finally {
      setPasskeyWorking(false);
    }
  }

  async function securityAction(input: SecurityActionInput, successText: string, onSuccess?: (response: Response) => Promise<void> | void, stepUpToken?: string) {
    setSecurityWorking(true);
    setMessage(null);
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.body ? { 'Content-Type': 'application/json' } : undefined,
        body: input.body ? JSON.stringify({ ...input.body, ...(stepUpToken ? { stepUpToken } : {}) }) : undefined,
      });
      if (!response.ok) {
        const data = await response.clone().json().catch(() => null) as { error?: string } | null;
        if (!stepUpToken && input.stepUpAction && response.status === 403 && data?.error === 'SECURITY_STEP_UP_REQUIRED') {
          pendingSecurityActionRef.current = { input, successText, onSuccess };
          setStepUpAction(input.stepUpAction);
          return;
        }
        throw new Error(await readError(response, '安全中心操作失败'));
      }
      if (onSuccess) {
        await onSuccess(response);
      } else {
        await loadSecurityCenter();
      }
      setMessage({ type: 'success', text: successText });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '安全中心操作失败' });
    } finally {
      setSecurityWorking(false);
    }
  }

  function revokeSession(session: SecuritySession) {
    if (session.current || !window.confirm('确定退出这个会话吗？')) return;
    void securityAction(
      { url: '/api/account/security/sessions', method: 'POST', body: { action: 'revoke', sessionRecordId: session.id }, stepUpAction: 'security_session_revoke' },
      '会话已退出。',
    );
  }

  function revokeOtherSessions() {
    if (!window.confirm('确定退出其他设备上的全部会话吗？')) return;
    void securityAction(
      { url: '/api/account/security/sessions', method: 'POST', body: { action: 'revoke-others' }, stepUpAction: 'security_session_revoke' },
      '其他设备上的会话已退出。',
    );
  }

  function revokeAllSessions() {
    if (!window.confirm('确定退出全部设备吗？当前会话也会失效。')) return;
    void securityAction(
      { url: '/api/account/security/sessions', method: 'POST', body: { action: 'revoke-all' }, stepUpAction: 'security_session_revoke' },
      '全部会话已退出。',
      async () => {
        await signOut({ callbackUrl: '/login?security=sessions-revoked' });
      },
    );
  }

  function renameDevice(device: SecurityDevice) {
    const name = window.prompt('设备名称', device.name || `${device.browser || '未知浏览器'} · ${device.operatingSystem || '未知系统'}`);
    if (name === null) return;
    void securityAction(
      { url: '/api/account/security/devices', method: 'PATCH', body: { deviceId: device.id, name } },
      '设备名称已更新。',
    );
  }

  function removeDevice(device: SecurityDevice) {
    if (!window.confirm('确定移除这个设备吗？关联会话也会退出。')) return;
    void securityAction(
      { url: '/api/account/security/devices', method: 'DELETE', body: { deviceId: device.id }, stepUpAction: 'security_device_remove' },
      '设备已移除。',
      async (response) => {
        const result = await response.json().catch(() => null) as { current?: boolean } | null;
        if (result?.current) await signOut({ callbackUrl: '/login?security=device-removed' });
        else await loadSecurityCenter();
      },
    );
  }

  function eventLabel(eventType: string): string {
    const labels: Record<string, string> = {
      LOGIN_SUCCESS: '登录成功',
      LOGIN_FAILED: '登录失败',
      MFA_ENABLED: '启用双因素认证',
      MFA_DISABLED: '关闭双因素认证',
      MFA_FAILED: '双因素认证失败',
      MFA_SUCCESS: '双因素认证成功',
      RECOVERY_USED: '使用恢复码',
      RECOVERY_CODES_REGENERATED: '重新生成恢复码',
      PASSKEY_CREATED: '添加通行密钥',
      PASSKEY_DELETED: '删除通行密钥',
      PASSKEY_LOGIN_SUCCESS: '通行密钥登录成功',
      PASSKEY_LOGIN_FAILED: '通行密钥登录失败',
      AUTHENTICATOR_DATA_CONFLICT: '认证器数据异常',
    };
    return labels[eventType] || eventType;
  }

  function reasonLabel(reason: string | undefined): string {
    const labels: Record<string, string> = {
      invalid_code: '验证码错误',
      rate_limited: '触发限流',
      challenge_expired: '验证请求过期',
      challenge_replayed: '验证请求重复使用',
      recovery_code_used: '使用恢复码',
    };
    return reason ? labels[reason] || '安全校验失败' : '';
  }

  const securityActivityRows: SecurityActivityRow[] = [
    ...securitySessions.map((session) => ({
      id: `session-${session.id}`,
      label: session.current ? '当前登录会话' : '登录会话',
      occurredAt: session.lastSeenAt,
      ip: session.ip || session.device?.ip || null,
      device: session.device?.name || [session.device?.browser, session.device?.operatingSystem].filter(Boolean).join(' · ') || '未知设备',
      detail: session.current ? '当前会话' : '',
      session,
    })),
    ...securityEvents.map((event) => ({
      id: `event-${event.id}`,
      label: eventLabel(event.eventType),
      occurredAt: event.createdAt,
      ip: event.ip,
      device: event.device || '未知设备',
      detail: event.metadata.reason ? reasonLabel(event.metadata.reason) : '',
    })),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setMessage({ type: 'error', text: '复制失败，请手动选择并复制。' });
    }
  }

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 pb-28 sm:px-6 sm:pb-12">
          <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '我的账户', href: '/account' }, { label: '账户安全' }]} />

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <AccountSidebar activeKey="security" />
            <div className="min-w-0 max-w-4xl flex-1">
          <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-slate-400 dark:bg-slate-200/65">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 text-brand-600" size={24} aria-hidden="true" />
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">账户安全</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-600">使用验证器为登录增加一层保护。恢复码只显示一次，请保存到安全位置。</p>
              </div>
            </div>
          </section>

          {message && (
            <div className={`mb-6 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`} role="status">
              {message.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}

          {loading ? (
            <section className="rounded-2xl border border-gray-100 bg-white p-5 text-sm text-gray-500 shadow-sm dark:border-slate-400 dark:bg-slate-200/65">
              正在读取账户安全状态…
            </section>
          ) : status && (
            <div className="flex flex-col">
              <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-slate-400 dark:bg-slate-200/65">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <LockKeyhole className={status.enabled ? 'mt-0.5 text-emerald-600' : 'mt-0.5 text-gray-400'} size={22} aria-hidden="true" />
                    <div>
                      <h2 className="text-base font-semibold text-gray-900 dark:text-slate-900">验证器应用</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-slate-600">
                        {status.enabled ? '已启用。密码、Google、微信和小程序登录都会要求验证。' : '尚未启用。可使用 Google Authenticator、Microsoft Authenticator、腾讯身份验证器、Apple 密码、Authy、1Password 或 Bitwarden 等验证器应用。'}
                      </p>
                    </div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                    {status.enabled ? '已启用' : '未启用'}
                  </span>
                </div>

                {!mfaAvailable ? (
                  <p className="mt-5 rounded-xl border border-dashed border-gray-200 px-4 py-5 text-sm text-gray-500">双因素认证功能当前未开放。</p>
                ) : status.enabled ? (
                  <div className="mt-5 grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-slate-300 dark:bg-slate-100/70">
                      <p className="text-xs text-gray-500">启用时间</p>
                      <p className="mt-1 font-medium text-gray-800">{formatDate(status.confirmedAt)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-slate-300 dark:bg-slate-100/70">
                      <p className="text-xs text-gray-500">最近验证</p>
                      <p className="mt-1 font-medium text-gray-800">{formatDate(status.lastVerifiedAt)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    <div className="max-w-md">
                      <label htmlFor="mfa-password" className="block text-xs font-semibold text-gray-700">当前账户密码</label>
                      <input id="mfa-password" type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} autoComplete="current-password" placeholder="首次设置双因素认证时需要输入" className="mt-1 w-full rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2" />
                    </div>
                    <button type="button" onClick={startSetup} disabled={working || !setupPassword} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
                      <KeyRound size={16} />
                      {working ? '准备中…' : '开始设置'}
                    </button>
                  </div>
                )}

                {status.enabled && (
                  <div className="mt-5 flex flex-wrap gap-3 border-t border-gray-100 pt-4 dark:border-slate-300">
                    <button type="button" onClick={() => void regenerateRecoveryCodes()} disabled={working} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
                      <RefreshCw size={16} />
                      重新生成恢复码
                    </button>
                    <button type="button" onClick={() => void disableMfa()} disabled={working} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2">
                      关闭双因素认证
                    </button>
                  </div>
                )}
              </section>

              {!setup && recoveryCodes.length > 0 && (
                <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-700 dark:bg-amber-950/35" role="alert">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-amber-900 dark:text-amber-100"><AlertCircle size={18} />立即保存恢复码</h2>
                  <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">每个恢复码只能使用一次。离开此页面后不会再次显示，请不要把它们发送给任何人。</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-amber-200 bg-white p-3 font-mono text-sm text-gray-900 dark:border-amber-700 dark:bg-slate-950/55 dark:text-slate-100 sm:grid-cols-3">
                    {recoveryCodes.map((recoveryCode) => <code key={recoveryCode} className="rounded-lg bg-amber-50 px-2 py-2 text-center dark:bg-amber-900/50 dark:text-amber-100">{recoveryCode}</code>)}
                  </div>
                  <button type="button" onClick={() => copyValue('recovery', recoveryCodes.join('\n'))} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-medium text-amber-900 transition hover:bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2">
                    {copied === 'recovery' ? <Check size={16} /> : <Copy size={16} />}
                    {copied === 'recovery' ? '已复制恢复码' : '复制全部恢复码'}
                  </button>
                </section>
              )}

              {setup && (
                <section className="mb-6 rounded-2xl border border-brand-200 bg-brand-50/60 p-5 shadow-sm">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900"><KeyRound size={18} className="text-brand-700" />绑定验证器应用</h2>
                  <p className="mt-2 text-sm text-gray-700">使用验证器应用扫描二维码，然后输入应用生成的 6 位验证码完成绑定。</p>
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-brand-200 bg-white p-4 sm:flex-row sm:items-start">
                      <div className="flex h-[220px] w-[220px] shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white p-2" aria-live="polite">
                        {qrCodeUrl ? (
                          <Image src={qrCodeUrl} alt="扫描以添加验证器" width={204} height={204} unoptimized />
                        ) : (
                          <span className="px-4 text-center text-xs text-gray-500">{qrCodeError ? '二维码生成失败，请使用下方 URI 或密钥。' : '正在生成二维码…'}</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-700">
                        <p className="font-semibold text-gray-900">扫码添加</p>
                        <p className="mt-1 leading-6">打开 Google Authenticator、Microsoft Authenticator、腾讯身份验证器、Apple 密码、Authy、1Password 或 Bitwarden 等验证器应用，扫描左侧二维码。</p>
                        <p className="mt-2 text-xs text-gray-500">二维码仅在当前页面本地生成，不会上传设置密钥。</p>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="mfa-secret" className="block text-xs font-semibold text-gray-700">手动设置密钥</label>
                      <div className="mt-1 flex gap-2">
                        <input id="mfa-secret" value={setup.secret} readOnly className="min-w-0 flex-1 rounded-xl border border-brand-200 bg-white px-3 py-2.5 font-mono text-sm text-gray-900" />
                        <button type="button" onClick={() => copyValue('secret', setup.secret)} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-brand-300 bg-white px-3 text-sm font-medium text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2" aria-label="复制设置密钥">
                          {copied === 'secret' ? <Check size={16} /> : <Copy size={16} />}
                          {copied === 'secret' ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="mfa-uri" className="block text-xs font-semibold text-gray-700">设置链接（可选）</label>
                      <textarea id="mfa-uri" value={setup.otpauthUrl} readOnly rows={3} className="mt-1 w-full resize-y rounded-xl border border-brand-200 bg-white px-3 py-2.5 font-mono text-xs text-gray-700" />
                      <button type="button" onClick={() => copyValue('uri', setup.otpauthUrl)} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand-300 bg-white px-3 py-2 text-sm font-medium text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
                        {copied === 'uri' ? <Check size={16} /> : <Copy size={16} />}
                        {copied === 'uri' ? '已复制 URI' : '复制 URI'}
                      </button>
                    </div>
                    <div>
                      <label htmlFor="mfa-code" className="block text-xs font-semibold text-gray-700">验证器验证码</label>
                      <input id="mfa-code" value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setSetupError(''); }} inputMode="numeric" maxLength={6} placeholder="输入 6 位验证码" className="mt-1 w-full max-w-xs rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-center text-lg tracking-[0.35em] text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2" />
                    </div>
                  </div>
                  <button type="button" onClick={confirmSetup} disabled={working || code.length !== 6} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
                    <ShieldCheck size={16} />
                    {working ? '确认中…' : '确认并启用'}
                  </button>
                  {setupError && <p className="mt-3 text-sm text-red-700" role="alert">{setupError}</p>}
                </section>
              )}

              {passkeyEnabled && (
              <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-slate-400 dark:bg-slate-200/65">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-slate-900">通行密钥</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-600">使用设备生物识别或系统密钥登录。添加和删除通行密钥前，需要再次确认身份。</p>
                  </div>
                  <button type="button" onClick={() => void registerPasskey()} disabled={passkeyWorking} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand-300 bg-white px-4 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
                    <KeyRound size={16} />
                    {passkeyWorking ? '处理中…' : '添加通行密钥'}
                  </button>
                </div>
                <p className="mt-3 text-sm text-gray-500">添加通行密钥前，需要再次确认身份。建议优先使用验证器应用。</p>
                {passkeys.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-500 dark:border-slate-300 dark:text-slate-600">尚未添加通行密钥。</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {passkeys.map((passkey) => (
                      <div key={passkey.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-slate-300 dark:bg-slate-100/70">
                        {editingPasskeyId === passkey.id ? (
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            <label htmlFor={`passkey-name-${passkey.id}`} className="sr-only">通行密钥名称</label>
                            <input id={`passkey-name-${passkey.id}`} value={passkeyNameDraft} onChange={(event) => setPasskeyNameDraft(event.target.value.slice(0, 80))} maxLength={80} autoFocus className="min-h-10 min-w-[12rem] flex-1 rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500" />
                            <button type="button" onClick={() => void savePasskeyName(passkey)} disabled={passkeyWorking} className="min-h-10 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">保存</button>
                            <button type="button" onClick={cancelRenamePasskey} disabled={passkeyWorking} className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60">取消</button>
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-800">{passkey.name || '通行密钥'}</p>
                            <p className="mt-1 text-xs text-gray-500">添加于 {formatDate(passkey.createdAt)}{passkey.lastUsedAt ? ` · 最近使用 ${formatDate(passkey.lastUsedAt)}` : ''}</p>
                          </div>
                        )}
                        {editingPasskeyId !== passkey.id && <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => beginRenamePasskey(passkey)} disabled={passkeyWorking} className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60">重命名</button><button type="button" onClick={() => void removePasskey(passkey)} disabled={passkeyWorking} className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2">删除</button></div>}
                      </div>
                    ))}
                  </div>
                )}
              </section>)}

              <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-slate-400 dark:bg-slate-200/65">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-slate-900">会话、设备与安全活动</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-600">查看登录设备、最近活动和登录地址。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={revokeOtherSessions} disabled={securityWorking} className="min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-60">退出其他设备</button>
                    <button type="button" onClick={revokeAllSessions} disabled={securityWorking} className="min-h-10 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60">退出全部设备</button>
                  </div>
                </div>

                {securityLoading ? (
                  <p className="mt-5 text-sm text-gray-500">正在读取会话与设备…</p>
                ) : (
                  <>
                    <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50 dark:divide-slate-300 dark:border-slate-300 dark:bg-slate-100/70">
                        <div className="hidden grid-cols-[minmax(9rem,1.2fr)_minmax(10rem,1.2fr)_minmax(8rem,1fr)_minmax(11rem,1.4fr)_minmax(4rem,auto)] gap-4 px-4 py-2.5 text-xs font-medium text-gray-500 sm:grid">
                          <span>活动</span>
                          <span>时间</span>
                          <span>IP 地址</span>
                          <span>设备</span>
                          <span>操作</span>
                        </div>
                        {securityActivityRows.length === 0 ? (
                          <p className="px-4 py-5 text-sm text-gray-500">暂无会话或安全活动记录。</p>
                        ) : securityActivityRows.map((row) => (
                          <div key={row.id} className="grid grid-cols-2 items-start gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[minmax(9rem,1.2fr)_minmax(10rem,1.2fr)_minmax(8rem,1fr)_minmax(11rem,1.4fr)_minmax(4rem,auto)] sm:items-center sm:gap-4">
                            <div className="min-w-0 font-medium text-gray-800">
                              <span className="mb-0.5 block text-[11px] font-normal text-gray-500 sm:hidden">活动</span>
                              {row.label}
                              {row.detail && <span className="ml-2 text-xs font-normal text-gray-500">{row.detail}</span>}
                            </div>
                            <span className="min-w-0 text-xs text-gray-600 sm:whitespace-nowrap"><span className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">时间</span>{formatDate(row.occurredAt)}</span>
                            <span className="min-w-0 break-words text-xs text-gray-600"><span className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">IP 地址</span>{row.ip || '未记录'}</span>
                            <span className="min-w-0 break-words text-xs text-gray-600" title={row.device}><span className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">设备</span>{row.device}</span>
                            <span className="col-span-2 flex items-center justify-end sm:col-span-1 sm:justify-start">
                              <span className="mr-2 text-[11px] text-gray-500 sm:hidden">操作</span>
                              {row.session && !row.session.current ? (
                                <button type="button" onClick={() => revokeSession(row.session!)} disabled={securityWorking} className="min-h-9 rounded-lg px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60">退出</button>
                              ) : '—'}
                            </span>
                          </div>
                        ))}
                    </div>

                    {securityDevices.length > 0 && (
                      <div className="mt-5 border-t border-gray-100 pt-5 dark:border-slate-300">
                        <h3 className="text-sm font-semibold text-gray-800">设备管理</h3>
                        <div className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-slate-300 dark:border-slate-300">
                            <div className="hidden grid-cols-[minmax(12rem,1.5fr)_minmax(10rem,1.2fr)_minmax(8rem,1fr)_minmax(6rem,auto)_minmax(9rem,auto)] gap-4 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-500 sm:grid dark:bg-slate-100/70">
                              <span>设备</span>
                              <span>最近活动</span>
                              <span>IP 地址</span>
                              <span>会话</span>
                              <span>操作</span>
                            </div>
                            {securityDevices.map((device) => (
                              <div key={device.id} className="grid grid-cols-2 items-start gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[minmax(12rem,1.5fr)_minmax(10rem,1.2fr)_minmax(8rem,1fr)_minmax(6rem,auto)_minmax(9rem,auto)] sm:items-center sm:gap-4">
                                <span className="min-w-0 break-words font-medium text-gray-800" title={device.name || undefined}><span className="mb-0.5 block text-[11px] font-normal text-gray-500 sm:hidden">设备</span>{device.name || [device.browser, device.operatingSystem].filter(Boolean).join(' · ') || '未知设备'}</span>
                                <span className="min-w-0 text-xs text-gray-600 sm:whitespace-nowrap"><span className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">最近活动</span>{formatDate(device.lastSeenAt)}</span>
                                <span className="min-w-0 break-words text-xs text-gray-600"><span className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">IP 地址</span>{device.ip || '未记录'}</span>
                                <span className="text-xs text-gray-600"><span className="mb-0.5 block text-[11px] text-gray-500 sm:hidden">会话</span>{device.sessionCount}</span>
                                <span className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1 sm:justify-start">
                                  <span className="mr-1 text-[11px] text-gray-500 sm:hidden">操作</span>
                                  <button type="button" onClick={() => renameDevice(device)} disabled={securityWorking} className="min-h-9 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-50 disabled:opacity-60">重命名</button>
                                  <button type="button" onClick={() => removeDevice(device)} disabled={securityWorking} className="min-h-9 rounded-lg px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60">移除</button>
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>

            </div>
          )}
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
      <MobileBottomNav />
      <SecurityStepUpDialog
        open={stepUpAction !== null}
        action={stepUpAction ?? 'passkey_add'}
        title={stepUpAction === 'passkey_delete' ? '确认身份后删除通行密钥' : stepUpAction === 'security_device_remove' ? '确认身份后移除设备' : stepUpAction === 'security_session_revoke' ? '确认身份后退出会话' : stepUpAction === 'mfa_disable' ? '确认身份后关闭双因素认证' : stepUpAction === 'recovery_codes' ? '确认身份后重新生成恢复码' : '确认身份后添加通行密钥'}
        description="修改安全设置前，需要再次确认身份。可使用验证器应用、手机短信或邮箱验证码。"
        onCancel={() => { setStepUpAction(null); setPendingPasskeyDeletion(null); pendingSecurityActionRef.current = null; }}
        onVerified={(grantToken) => {
          const action = stepUpAction;
          const pending = pendingPasskeyDeletion;
          const pendingSecurityAction = pendingSecurityActionRef.current;
          setStepUpAction(null);
          setPendingPasskeyDeletion(null);
          pendingSecurityActionRef.current = null;
          if (action === 'passkey_add') void registerPasskey(grantToken);
          if (action === 'passkey_delete' && pending) void removePasskey(pending, grantToken);
          if (action === 'mfa_disable') void disableMfa(grantToken);
          if (action === 'recovery_codes') void regenerateRecoveryCodes(grantToken);
          if ((action === 'security_session_revoke' || action === 'security_device_remove') && pendingSecurityAction) {
            void securityAction(pendingSecurityAction.input, pendingSecurityAction.successText, pendingSecurityAction.onSuccess, grantToken);
          }
        }}
      />
    </div>
  );
}
