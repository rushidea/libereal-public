'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Mail, Lock, User, BookOpen, AlertCircle, Check, X, Eye, EyeOff, Phone, MessageSquare, Plus, Minus, FlaskConical, GraduationCap, School, Building } from 'lucide-react';
import TurnstileWidget from '@/components/TurnstileWidget';
import { isGoogleLoginEnabled } from '@/lib/auth-helpers';
import LegalConsentChecklist from '@/components/legal/LegalConsentChecklist';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { signInWithWeChat } from '@/lib/wechat-sign-in';
import { getInstitutionLabels, isSchoolInstitutionType } from '@/data/institution-profile';

function RegisterForm() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const searchParams = useSearchParams();
  const wechat = searchParams.get('wechat');
  const oauth = searchParams.get('oauth');
  const oauthEmail = searchParams.get('email') ?? '';

  const notice = useMemo(() => {
    if (wechat === 'unlinked') {
      return '该微信尚未绑定账户。请填写信息完成注册；若该邮箱已注册，提交后将引导您输入密码绑定微信。';
    }
    if (oauth === 'google') {
      return '该 Google 账号尚未注册。请使用相同邮箱完成注册；若该邮箱已注册，提交后将引导您输入密码绑定 Google。';
    }
    return '';
  }, [wechat, oauth]);

  const [form, setForm] = useState({
    name: '',
    email: oauthEmail,
    emailCode: '',
    phone: '',
    smsCode: '',
    password: '',
    confirmPassword: '',
    // === 注册资料（锁定）===
    institutionType: '高校',
    institutionName: '',
    institutionUnit: '',
    department: '',
    institutionFacility: '',
    piLab: '',
    // === 选填：依托实验室 ===
    showAffiliatedLab: false,
    affiliatedLab: '',
  });
  const [loading, setLoading] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<'google' | 'wechat' | null>(null);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedLegalIds, setAcceptedLegalIds] = useState<string[]>([]);
  const [requiredLegalIds, setRequiredLegalIds] = useState<string[]>([]);
  const [smsSending, setSmsSending] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [emailSending, setEmailSending] = useState(false);
  const [emailCountdown, setEmailCountdown] = useState(0);

  useEffect(() => {
    if (wechat === 'unlinked' && sessionStatus === 'authenticated') {
      router.replace('/account');
    }
  }, [router, sessionStatus, wechat]);

  const passwordChecks = useMemo(() => ({
    length: form.password.length >= 8,
    uppercase: /[A-Z]/.test(form.password),
    lowercase: /[a-z]/.test(form.password),
    digit: /\d/.test(form.password),
    special: /[!@#$%^&*()_+=\-]/.test(form.password),
  }), [form.password]);

  const passwordStrength = useMemo(() => {
    const count = Object.values(passwordChecks).filter(Boolean).length;
    if (count <= 2) return { level: 'weak', text: '弱', color: 'bg-red-500' };
    if (count <= 4) return { level: 'medium', text: '中等', color: 'bg-amber-500' };
    return { level: 'strong', text: '强', color: 'bg-green-500' };
  }, [passwordChecks]);

  const isPasswordValid = Object.values(passwordChecks).every(Boolean);
  const doPasswordsMatch = form.confirmPassword.length > 0 && form.password === form.confirmPassword;
  const legalAccepted =
    requiredLegalIds.length === 0 || requiredLegalIds.every((id) => acceptedLegalIds.includes(id));
  const phoneValid = /^1[3-9]\d{9}$/.test(form.phone.replace(/\D/g, ''));
  const smsCodeValid = /^\d{6}$/.test(form.smsCode.trim());
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const emailCodeValid = /^\d{6}$/.test(form.emailCode.trim());
  const institutionLabels = getInstitutionLabels(form.institutionType);
  const institutionFieldsValid = form.institutionType.trim() && form.institutionName.trim() && form.institutionUnit.trim() && form.department.trim() && form.institutionFacility.trim() && form.piLab.trim();
  const canSubmit = form.name && emailValid && emailCodeValid && phoneValid && smsCodeValid && isPasswordValid && doPasswordsMatch && institutionFieldsValid && turnstileToken && legalAccepted;

  useEffect(() => {
    if (smsCountdown <= 0) return;
    const timer = window.setTimeout(() => setSmsCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [smsCountdown]);

  useEffect(() => {
    if (emailCountdown <= 0) return;
    const timer = window.setTimeout(() => setEmailCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCountdown]);

  const sendEmailCode = async () => {
    setError('');
    if (!emailValid) {
      setError('请先输入有效的邮箱地址');
      return;
    }
    setEmailSending(true);
    try {
      const res = await fetch('/api/auth/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '邮箱验证码发送失败，请稍后重试');
        return;
      }
      setEmailCountdown(60);
    } catch {
      setError('邮箱验证码发送失败，请稍后重试');
    } finally {
      setEmailSending(false);
    }
  };

  const sendSmsCode = async () => {
    setError('');
    if (!phoneValid) {
      setError('请先输入有效的中国大陆手机号');
      return;
    }
    setSmsSending(true);
    try {
      const res = await fetch('/api/auth/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '验证码发送失败，请稍后重试');
        return;
      }
      setSmsCountdown(60);
    } catch {
      setError('验证码发送失败，请稍后重试');
    } finally {
      setSmsSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isPasswordValid) {
      setError('密码不符合要求，请检查密码强度');
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          emailCode: form.emailCode,
          phone: form.phone,
          smsCode: form.smsCode,
          password: form.password,
          institutionType: form.institutionType,
          institutionName: form.institutionName,
          institutionUnit: form.institutionUnit,
          institutionDepartment: form.department,
          department: form.department,
          institutionFacility: form.institutionFacility,
          school: isSchoolInstitutionType(form.institutionType) ? form.institutionName : '',
          college: isSchoolInstitutionType(form.institutionType) ? form.institutionUnit : '',
          major: isSchoolInstitutionType(form.institutionType) ? form.department : '',
          building: isSchoolInstitutionType(form.institutionType) ? form.institutionFacility : '',
          piLab: form.piLab,
          affiliatedLab: form.affiliatedLab,
          turnstileToken,
          acceptedLegalIds,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'merge_required' && data.redirect) {
          window.location.href = data.redirect;
          return;
        }
        setError(data.error || '注册失败，请重试。');
        setLoading(false);
        return;
      }

      if (data.merged && data.email) {
        const signInResult = await signIn('credentials', {
          email: data.email,
          password: form.password,
          redirect: false,
        });
        if (signInResult?.error) {
          setError('账号已合并，但自动登录失败，请使用已有密码手动登录');
          setLoading(false);
          return;
        }
        window.location.href = '/account';
        return;
      }

      const signInResult = await signIn('credentials', {
        email: data.email ?? form.email,
        password: form.password,
        redirect: false,
      });

      if (signInResult?.error) {
        setError('注册成功但自动登录失败，请手动登录后继续绑定');
        setLoading(false);
        return;
      }

      await fetch('/api/account/complete-oauth-link', { method: 'POST' });

      window.location.href = '/register/link';
    } catch {
      setError('注册失败，请重试。');
      setLoading(false);
    }
  };

  const handleOAuthRegister = async (provider: 'google' | 'wechat') => {
    setLinkingProvider(provider);
    setError('');
    try {
      const callbackUrl = `/register?${provider === 'google' ? 'oauth=google' : 'wechat=unlinked'}`;
      if (provider === 'wechat') {
        await signInWithWeChat(callbackUrl);
      } else {
        await signIn(provider, { callbackUrl });
      }
    } catch {
      setError(`${provider === 'google' ? 'Google' : '微信'} 注册启动失败，请重试`);
      setLinkingProvider(null);
    }
  };

  const inputClass = 'w-full border border-white/50 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-800 bg-white/60 backdrop-blur-sm focus:bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all';

  if (wechat === 'unlinked' && sessionStatus === 'authenticated') {
    return <div className="min-h-screen libereal-service-page" />;
  }

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/50 p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-1">创建账户</h1>
              <p className="text-gray-500 text-sm">注册后即可享受更便捷的询价体验</p>
            </div>

            {error && (
              <div className="mb-5 flex items-center gap-2 bg-red-100/70 backdrop-blur-sm border border-red-200/50 text-red-600 rounded-xl px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className="mb-5 flex items-center gap-2 bg-amber-100/70 backdrop-blur-sm border border-amber-200/50 text-amber-700 rounded-xl px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            <div className="w-full mb-6 space-y-3">
              {isGoogleLoginEnabled() && (
              <button
                type="button"
                onClick={() => handleOAuthRegister('google')}
                disabled={!!linkingProvider}
                className="w-full flex items-center justify-center gap-3 border border-white/50 hover:border-gray-300 hover:bg-white/80 backdrop-blur-sm rounded-xl px-4 py-3 text-sm font-medium text-gray-700 transition-colors shadow-sm disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {linkingProvider === 'google' ? '正在跳转...' : '使用 Google 注册'}
              </button>
              )}
              <button
                type="button"
                onClick={() => handleOAuthRegister('wechat')}
                disabled={!!linkingProvider}
                className="w-full flex items-center justify-center gap-3 border border-white/50 hover:border-green-300 hover:bg-white/80 backdrop-blur-sm rounded-xl px-4 py-3 text-sm font-medium text-gray-700 transition-colors shadow-sm disabled:opacity-50"
              >
                <Image src="/images/wechat-logo.svg" alt="" width={28} height={28} className="h-5 w-5" />
                {linkingProvider === 'wechat' ? '正在跳转...' : '使用微信注册'}
              </button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-transparent text-gray-400">或使用邮箱注册</span>
              </div>
            </div>

            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-800">
              <p className="font-medium text-sm mb-1">⚠️ 注册资料提交后不可更改</p>
              <p>手机号一年内只能修改一次，学校/学院/学系/楼号/PI实验室信息注册后锁定。<br />请按真实信息逐一填写下方字段，提交后不可更改。</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> 姓名 <span className="text-red-400">*</span></span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    required
                    placeholder="张三"
                    value={form.name}
                    onChange={(e) => setForm(form => ({...form, name: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> 邮箱 <span className="text-red-400">*</span></span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    required
                    placeholder="you@institution.edu.cn"
                    value={form.email}
                    onChange={(e) => setForm(form => ({...form, email: e.target.value }))}
                    readOnly={oauth === 'google'}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> 邮箱验证码 <span className="text-red-400">*</span></span>
                </label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6 位验证码"
                      value={form.emailCode}
                      onChange={(e) => setForm(form => ({...form, emailCode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={sendEmailCode}
                    disabled={emailSending || emailCountdown > 0 || !emailValid}
                    className="h-[42px] flex-shrink-0 rounded-xl border border-brand-200 bg-white/70 px-3 text-sm font-medium text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                  >
                    {emailSending ? '发送中' : emailCountdown > 0 ? `${emailCountdown}s` : '获取验证码'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> 手机号 <span className="text-red-400">*</span></span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="tel"
                    required
                    inputMode="tel"
                    placeholder="13800000000"
                    value={form.phone}
                    onChange={(e) => setForm(form => ({...form, phone: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> 短信验证码 <span className="text-red-400">*</span></span>
                </label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6 位验证码"
                      value={form.smsCode}
                      onChange={(e) => setForm(form => ({...form, smsCode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={sendSmsCode}
                    disabled={smsSending || smsCountdown > 0 || !phoneValid}
                    className="h-[42px] flex-shrink-0 rounded-xl border border-brand-200 bg-white/70 px-3 text-sm font-medium text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                  >
                    {smsSending ? '发送中' : smsCountdown > 0 ? `${smsCountdown}s` : '获取验证码'}
                  </button>
                </div>
              </div>

              {/* === 注册资料结构字段（锁定） === */}
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 mb-3">
                <p className="text-xs text-amber-700">
                  <span className="font-medium">以下信息注册后不可更改</span>，请按所在机构的组织关系填写。
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="flex items-center gap-1.5"><School className="w-3.5 h-3.5" /> 机构类型 <span className="text-red-400">*</span></span>
                  </label>
                  <input
                    type="text"
                    list="institution-types"
                    required
                    placeholder="高校、医院、科研院所或其他"
                    value={form.institutionType}
                    onChange={(e) => setForm(form => ({...form, institutionType: e.target.value }))}
                    className={inputClass}
                  />
                  <datalist id="institution-types">
                    <option value="高校" />
                    <option value="医院" />
                    <option value="科研院所" />
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="flex items-center gap-1.5"><School className="w-3.5 h-3.5" /> {institutionLabels.name} <span className="text-red-400">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={institutionLabels.name === '医院' ? '某某医院' : institutionLabels.name === '科研院所' ? '某某研究院' : '南京医科大学'}
                    value={form.institutionName}
                    onChange={(e) => setForm(form => ({...form, institutionName: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> {institutionLabels.unit} <span className="text-red-400">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={institutionLabels.unit}
                    value={form.institutionUnit}
                    onChange={(e) => setForm(form => ({...form, institutionUnit: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <span className="flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> {institutionLabels.department} <span className="text-red-400">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={institutionLabels.department}
                    value={form.department}
                    onChange={(e) => setForm(form => ({...form, department: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><Building className="w-3.5 h-3.5" /> {institutionLabels.facility} <span className="text-red-400">*</span></span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={institutionLabels.facility}
                  value={form.institutionFacility}
                  onChange={(e) => setForm(form => ({...form, institutionFacility: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> PI / 导师实验室 <span className="text-red-400">*</span></span>
                </label>
                <input
                  type="text"
                  placeholder="XXX（导师姓名）实验室"
                  value={form.piLab}
                  onChange={(e) => setForm(form => ({...form, piLab: e.target.value }))}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-gray-400">请填写您的导师姓名及其实验室名称，注册后不可修改</p>
              </div>

              {/* ➕ 依托实验室（选填） */}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setForm(form => ({...form, showAffiliatedLab: !form.showAffiliatedLab}))}
                  className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
                >
                  {form.showAffiliatedLab ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  <span>{form.showAffiliatedLab ? '收起依托实验室信息' : '添加依托实验室信息（选填）'}</span>
                </button>
                {form.showAffiliatedLab && (
                  <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      <span className="flex items-center gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> 依托实验室（选填）</span>
                    </label>
                    <p className="text-xs text-gray-400 mb-2">如果您所在的实验室与导师 PI 实验室不同，请填写您实际所在的实验室名称</p>
                    <input
                      type="text"
                      placeholder="实际所在实验室名称"
                      value={form.affiliatedLab}
                      onChange={(e) => setForm(form => ({...form, affiliatedLab: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> 密码 <span className="text-red-400">*</span></span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="至少 8 个字符，包含大小写、数字和符号"
                    value={form.password}
                    onChange={(e) => setForm(form => ({...form, password: e.target.value }))}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 px-2"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full transition-all ${passwordStrength.color}`} style={{ width: `${(Object.values(passwordChecks).filter(Boolean).length / 5) * 100}%` }} />
                      </div>
                      <span className="text-xs font-medium text-gray-500">{passwordStrength.text}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div className={`flex items-center gap-1 ${passwordChecks.length ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.length ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} 8位以上
                      </div>
                      <div className={`flex items-center gap-1 ${passwordChecks.uppercase ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.uppercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} 大写字母
                      </div>
                      <div className={`flex items-center gap-1 ${passwordChecks.lowercase ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.lowercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} 小写字母
                      </div>
                      <div className={`flex items-center gap-1 ${passwordChecks.digit ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.digit ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} 数字
                      </div>
                      <div className={`flex items-center gap-1 ${passwordChecks.special ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.special ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} 符号 (!@#$%^&*...)
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> 确认密码 <span className="text-red-400">*</span></span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    placeholder="再次输入密码"
                    value={form.confirmPassword}
                    onChange={(e) => setForm(form => ({...form, confirmPassword: e.target.value }))}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(v => !v)}
                    className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 px-2"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.confirmPassword.length > 0 && (
                  <p className={`mt-1.5 text-xs flex items-center gap-1 ${doPasswordsMatch ? 'text-green-600' : 'text-red-500'}`}>
                    {doPasswordsMatch ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {doPasswordsMatch ? '密码一致' : '密码不一致'}
                  </p>
                )}
              </div>

              <div className="mt-4">
                <TurnstileWidget
                  onVerify={(token) => setTurnstileToken(token)}
                  theme="auto"
                />
              </div>

              <LegalConsentChecklist
                context="register"
                acceptedIds={acceptedLegalIds}
                onChange={setAcceptedLegalIds}
                onRequiredIdsChange={setRequiredLegalIds}
                className="mt-4"
              />

              <button
                type="submit"
                disabled={loading || !canSubmit}
                className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    注册中...
                  </>
                ) : '创建账户'}
              </button>
              {!canSubmit && form.password.length > 0 && !isPasswordValid && (
                <p className="text-xs text-gray-400 text-center mt-1">请确保密码满足所有要求</p>
              )}
            </form>

            <div className="mt-5 text-center">
              <p className="text-sm text-gray-400">
                已有账户？{' '}
                <Link href="/login" className="text-brand-600 hover:text-brand-700 font-medium">
                  立即登录
                </Link>
              </p>
            </div>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-gray-400 hover:text-brand-600">
              ← 返回首页
            </Link>
          </div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

export default function RegisterClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <RegisterForm />
    </Suspense>
  );
}
