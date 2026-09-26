'use client';

import Image from 'next/image';

import { useState, useEffect, type ChangeEvent } from 'react';
import { signIn } from 'next-auth/react';
import { signInWithWeChat } from '@/lib/wechat-sign-in';
import { User, Mail, Phone, Shield, CheckCircle, Lock, Eye, EyeOff, AlertCircle, KeyRound, MessageSquare } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import Breadcrumb from '@/components/Breadcrumb';
import AccountSidebar from '@/components/account/AccountSidebar';
import { getInstitutionLabels } from '@/data/institution-profile';
import SecurityStepUpDialog from '@/components/security/SecurityStepUpDialog';

type ProfileState = {
  name: string;
  email: string;
  tel: string;
  company: string;
  institutionType: string;
  institutionName: string;
  institutionUnit: string;
  department: string;
  institutionFacility: string;
  identity: string;
  advisorName: string;
  advisorPhone: string;
  school: string;
  college: string;
  major: string;
  building: string;
  piLab: string;
  affiliatedLab: string;
  wechatNickname: string;
  avatar: string;
  displayAvatarUrl: string;
  googleLinked: boolean;
  wechatLinked: boolean;
  hasPassword: boolean;
  placeholderEmail: boolean;
  linkedProviders: string[];
  phoneVerified: boolean;
  phoneLastChangedAt: string | null;
};

const emptyProfile: ProfileState = {
  name: '',
  email: '',
  tel: '',
  company: '',
  institutionType: '',
  institutionName: '',
  institutionUnit: '',
  department: '',
  institutionFacility: '',
  identity: '',
  advisorName: '',
  advisorPhone: '',
  school: '',
  college: '',
  major: '',
  building: '',
  piLab: '',
  affiliatedLab: '',
  wechatNickname: '',
  avatar: '',
  displayAvatarUrl: '',
  googleLinked: false,
  wechatLinked: false,
  hasPassword: false,
  placeholderEmail: false,
  linkedProviders: [],
  phoneVerified: false,
  phoneLastChangedAt: null,
};

export default function AccountSettingsPage() {
  const [profile, setProfile] = useState<ProfileState>(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [googleLinkStatus, setGoogleLinkStatus] = useState<'success' | 'conflict' | ''>('');
  const [wechatLinkStatus, setWechatLinkStatus] = useState<'success' | 'conflict' | ''>('');
  const [linkingProvider, setLinkingProvider] = useState<'google' | 'wechat' | null>(null);
  const [originalPhone, setOriginalPhone] = useState('');
  const [phoneSmsCode, setPhoneSmsCode] = useState('');
  const [phoneSmsSending, setPhoneSmsSending] = useState(false);
  const [phoneSmsCountdown, setPhoneSmsCountdown] = useState(0);

  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [credentialForm, setCredentialForm] = useState({ email: '', password: '', confirmPassword: '' });
  const [showCredentialPassword, setShowCredentialPassword] = useState(false);
  const [credentialMsg, setCredentialMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [stepUpAction, setStepUpAction] = useState<'password_change' | 'password_setup' | null>(null);
  const institutionLabels = getInstitutionLabels(profile.institutionType);

  const loadProfile = () => {
    fetch('/api/profile').then(r => r.json()).then(data => {
      if (data.profile) {
        setProfile({
          name: data.profile.name || '',
          email: data.profile.email || '',
          tel: data.profile.phone || '',
          company: data.profile.institution || '',
          institutionType: data.profile.institutionType || '',
          institutionName: data.profile.institutionName || data.profile.school || data.profile.institution || '',
          institutionUnit: data.profile.institutionUnit || data.profile.college || '',
          department: data.profile.department || data.profile.major || '',
          institutionFacility: data.profile.institutionFacility || data.profile.building || '',
          identity: data.profile.identity || '',
          advisorName: data.profile.advisorName || '',
          advisorPhone: data.profile.advisorPhone || '',
          school: data.profile.school || '',
          college: data.profile.college || '',
          major: data.profile.major || '',
          building: data.profile.building || '',
          piLab: data.profile.piLab || '',
          affiliatedLab: data.profile.affiliatedLab || '',
          wechatNickname: data.profile.wechatNickname || data.profile.name || '',
          avatar: data.profile.avatar || '',
          displayAvatarUrl: data.profile.displayAvatarUrl || '',
          googleLinked: !!data.profile.googleLinked,
          wechatLinked: !!data.profile.wechatLinked,
          hasPassword: !!data.profile.hasPassword,
          placeholderEmail: !!data.profile.placeholderEmail,
          linkedProviders: data.profile.linkedProviders || [],
          phoneVerified: !!data.profile.phoneVerified,
          phoneLastChangedAt: data.profile.phoneLastChangedAt || null,
        });
        setOriginalPhone(data.profile.phone || '');
      }
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get('oauthLink');
    const wechatStatus = params.get('wechatLink');
    if (googleStatus === 'success' || googleStatus === 'conflict') {
      setGoogleLinkStatus(googleStatus);
    }
    if (wechatStatus === 'success' || wechatStatus === 'conflict') {
      setWechatLinkStatus(wechatStatus);
    }

    loadProfile();
  }, []);

  useEffect(() => {
    if (phoneSmsCountdown <= 0) return;
    const timer = window.setTimeout(() => setPhoneSmsCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [phoneSmsCountdown]);

  const phoneChanged = profile.tel.trim() !== originalPhone;
  const currentAvatar = profile.displayAvatarUrl || profile.avatar;
  const canChangePhoneByDate =
    !profile.phoneLastChangedAt ||
    Date.now() - new Date(profile.phoneLastChangedAt).getTime() >= 365 * 24 * 60 * 60 * 1000;

  const handleSendPhoneSms = async () => {
    setPhoneSmsSending(true);
    try {
      const res = await fetch('/api/auth/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: profile.tel, purpose: 'phone-change' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '验证码发送失败');
        return;
      }
      setPhoneSmsCountdown(60);
    } catch {
      alert('验证码发送失败');
    } finally {
      setPhoneSmsSending(false);
    }
  };

  const handleLinkProvider = async (provider: 'google' | 'wechat') => {
    setLinkingProvider(provider);
    try {
      const res = await fetch('/api/account/link-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '绑定失败');
        return;
      }
      if (provider === 'wechat') {
        await signInWithWeChat(data.callbackUrl);
      } else {
        await signIn(provider, { callbackUrl: data.callbackUrl });
      }
    } catch {
      alert('绑定启动失败，请重试');
    } finally {
      setLinkingProvider(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: profile.name,
            phone: profile.tel,
            smsCode: phoneChanged ? phoneSmsCode : undefined,
            wechatNickname: profile.wechatNickname,
            displayAvatarUrl: profile.displayAvatarUrl,
          }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '保存失败');
      } else {
        setOriginalPhone(profile.tel.trim());
        setPhoneSmsCode('');
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        loadProfile();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('头像图片不能超过 2 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfile(current => ({ ...current, displayAvatarUrl: reader.result as string }));
      }
    };
    reader.onerror = () => alert('头像读取失败，请重新选择');
    reader.readAsDataURL(file);
  };

  const handleSetPassword = async (stepUpToken?: string) => {
    if (credentialForm.password !== credentialForm.confirmPassword) {
      setCredentialMsg({ type: 'error', text: '两次输入的密码不一致' });
      return;
    }
    if (credentialForm.password.length < 8) {
      setCredentialMsg({ type: 'error', text: '密码至少 8 位' });
      return;
    }
    if (profile.placeholderEmail && !credentialForm.email) {
      setCredentialMsg({ type: 'error', text: '请填写邮箱' });
      return;
    }
    if (!stepUpToken) {
      setStepUpAction('password_setup');
      return;
    }

    setCredentialSaving(true);
    setCredentialMsg(null);
    try {
      const res = await fetch('/api/account/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: profile.placeholderEmail ? credentialForm.email : undefined,
          password: credentialForm.password,
          confirmPassword: credentialForm.confirmPassword,
          stepUpToken,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCredentialMsg({ type: 'success', text: data.message || '邮箱与密码设置成功' });
        setCredentialForm({ email: '', password: '', confirmPassword: '' });
        loadProfile();
      } else {
        setCredentialMsg({ type: 'error', text: data.error || '设置失败' });
      }
    } catch {
      setCredentialMsg({ type: 'error', text: '网络错误' });
    } finally {
      setCredentialSaving(false);
    }
  };

  const handlePasswordChange = async (stepUpToken?: string) => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordMsg({ type: 'error', text: '请填写所有密码字段' });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMsg({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: '新密码长度至少为 6 位' });
      return;
    }
    if (!stepUpToken) {
      setStepUpAction('password_change');
      return;
    }
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
          stepUpToken,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg({ type: 'success', text: '密码修改成功' });
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        setPasswordMsg({ type: 'error', text: data.error || '修改失败' });
      }
    } catch {
      setPasswordMsg({ type: 'error', text: '网络错误' });
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />

      <div className="flex-1">
        <div className="max-w-6xl mx-auto px-4">
          <Breadcrumb items={[
            { label: '首页', href: '/' },
            { label: '我的账户', href: '/account' },
            { label: '账户设置' }
          ]} />

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <AccountSidebar activeKey="settings" />
            <div className="min-w-0 max-w-4xl flex-1">
          <div className="mb-4 bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Shield className="text-brand-600" size={22} />
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">账户设置</h1>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">修改您的个人信息</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4 mb-6">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-900 mb-4">基本信息</h2>
            {googleLinkStatus === 'success' && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
                <span>Google 账号已绑定。</span>
              </div>
            )}
            {googleLinkStatus === 'conflict' && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>该 Google 账号已绑定其他账户，或邮箱已被占用。</span>
              </div>
            )}
            {wechatLinkStatus === 'success' && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
                <span>微信账号已绑定。</span>
              </div>
            )}
            {wechatLinkStatus === 'conflict' && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>该微信账号已绑定其他账户。</span>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">姓名</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <input
                    value={profile.name}
                    onChange={e => setProfile(profile => ({...profile, name: e.target.value }))}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">邮箱</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <input
                    value={profile.email}
                    disabled
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                  <Lock size={12} className="inline mr-1 text-amber-500" />
                  手机 <span className="text-amber-500 text-xs">（1年只可改1次）</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <input
                    value={profile.tel}
                    onChange={e => setProfile(profile => ({...profile, tel: e.target.value }))}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  {profile.phoneVerified ? '手机号已验证。' : '手机号尚未验证。'}手机号一年内只能更改一次。
                </p>
                {phoneChanged && (
                  <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                    {!canChangePhoneByDate ? (
                      <p className="text-xs text-amber-700">当前账号一年内已更改过手机号，暂不能再次更改。</p>
                    ) : (
                      <div className="flex gap-2">
                        <div className="relative min-w-0 flex-1">
                          <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            value={phoneSmsCode}
                            onChange={e => setPhoneSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="新手机号验证码"
                            className="w-full pl-10 pr-3 py-2 border border-amber-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-brand-400"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleSendPhoneSms}
                          disabled={phoneSmsSending || phoneSmsCountdown > 0}
                          className="flex-shrink-0 rounded-lg border border-amber-200 bg-white px-3 text-sm font-medium text-amber-700 disabled:text-gray-400"
                        >
                          {phoneSmsSending ? '发送中' : phoneSmsCountdown > 0 ? `${phoneSmsCountdown}s` : '获取验证码'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 mb-4">
                <p className="text-xs text-amber-700">
                  <span className="font-medium">机构层级、实验室、身份和导师信息注册后锁定</span>，如需修改请联系客服。
                  手机号一年内可修改一次。
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                    <Lock size={12} className="inline mr-1 text-amber-500" />
                    {institutionLabels.name} <span className="text-amber-500 text-xs">（锁定）</span>
                  </label>
                  <input value={profile.institutionName} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                    <Lock size={12} className="inline mr-1 text-amber-500" />
                    {institutionLabels.unit} <span className="text-amber-500 text-xs">（锁定）</span>
                  </label>
                  <input value={profile.institutionUnit} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                    <Lock size={12} className="inline mr-1 text-amber-500" />
                    {institutionLabels.department} <span className="text-amber-500 text-xs">（锁定）</span>
                  </label>
                  <input value={profile.department} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                    <Lock size={12} className="inline mr-1 text-amber-500" />
                    {institutionLabels.facility} <span className="text-amber-500 text-xs">（锁定）</span>
                  </label>
                  <input value={profile.institutionFacility} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                  <Lock size={12} className="inline mr-1 text-amber-500" />
                  PI / 导师实验室 <span className="text-amber-500 text-xs">（锁定）</span>
                </label>
                <input value={profile.piLab} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
              </div>
              {profile.affiliatedLab && (
                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                    <Lock size={12} className="inline mr-1 text-amber-500" />
                    依托实验室 <span className="text-amber-500 text-xs">（锁定）</span>
                  </label>
                  <input value={profile.affiliatedLab} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
                </div>
              )}
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                  <Lock size={12} className="inline mr-1 text-amber-500" />
                  身份 <span className="text-amber-500 text-xs">（锁定）</span>
                </label>
                <input value={profile.identity} disabled placeholder="如：教授、研究员、学生" className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
              </div>
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                  <Lock size={12} className="inline mr-1 text-amber-500" />
                  导师姓名 <span className="text-amber-500 text-xs">（锁定）</span>
                </label>
                <input value={profile.advisorName} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
              </div>
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">
                  <Lock size={12} className="inline mr-1 text-amber-500" />
                  导师电话 <span className="text-amber-500 text-xs">（锁定）</span>
                </label>
                <input value={profile.advisorPhone} disabled className="w-full px-4 py-2.5 border border-gray-100 dark:border-slate-400 rounded-xl text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-700/50" />
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : saved ? <><CheckCircle size={16} /> 已保存</> : '保存修改'}
            </button>
          </div>

          <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4 mb-6">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-900 mb-4">登录方式</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-gray-200">
                    <Mail className="h-4 w-4 text-gray-600" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">邮箱密码</p>
                    <p className="text-xs text-gray-500">{profile.hasPassword ? '已设置，可使用邮箱密码登录' : '未设置独立密码'}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium ${profile.hasPassword ? 'text-green-600' : 'text-gray-400'}`}>
                  {profile.hasPassword ? '已启用' : '未启用'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-gray-200">
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Google 登录</p>
                    <p className="text-xs text-gray-500">{profile.googleLinked ? '已绑定，可使用 Google 登录' : '绑定后可使用 Google 登录'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleLinkProvider('google')}
                  disabled={profile.googleLinked || linkingProvider === 'google'}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {profile.googleLinked ? '已绑定' : linkingProvider === 'google' ? '跳转中...' : '绑定'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Image src="/images/wechat-logo.svg" alt="" width={28} height={28} className="h-9 w-9" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">微信登录</p>
                    <p className="text-xs text-gray-500">{profile.wechatLinked ? '已绑定，可使用微信授权登录' : '绑定后可使用微信授权登录'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleLinkProvider('wechat')}
                  disabled={profile.wechatLinked || linkingProvider === 'wechat'}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {profile.wechatLinked ? '已绑定' : linkingProvider === 'wechat' ? '跳转中...' : '绑定'}
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-800">双因素认证</p>
                <p className="text-xs text-gray-500">使用验证器为账户增加额外保护。</p>
              </div>
              <a href="/account/security" className="inline-flex min-h-11 items-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2">
                管理账户安全
              </a>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4 mb-6">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-900 mb-2">社区展示信息</h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">当您贡献实验方案或配方被批准公开时，以下信息将显示在贡献者处。</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">微信昵称</label>
                <input
                  value={profile.wechatNickname}
                  onChange={e => setProfile(profile => ({...profile, wechatNickname: e.target.value }))}
                  placeholder="您希望显示的昵称"
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-100 dark:border-slate-400 dark:bg-slate-700">
                  {currentAvatar ? (
                    <Image
                      src={currentAvatar}
                      alt="当前头像"
                      width={64}
                      height={64}
                      unoptimized
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-7 w-7 text-gray-400 dark:text-slate-400" />
                  )}
                </div>
                <div>
                  <label className="inline-flex cursor-pointer items-center rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
                    本地更换头像
                    <input type="file" accept="image/*" onChange={handleAvatarChange} className="sr-only" />
                  </label>
                  <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">支持 JPG、PNG、WebP，最大 2 MB</p>
                </div>
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : saved ? <><CheckCircle size={16} /> 已保存</> : '保存社区信息'}
            </button>
          </div>

          {!profile.hasPassword && (
            <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4 mb-6">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-900 mb-2 flex items-center gap-2">
                <KeyRound size={16} className="text-gray-400 dark:text-gray-500" />
                设置邮箱与密码
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
                {profile.placeholderEmail
                  ? '您当前使用第三方登录，请设置真实邮箱和独立密码以便邮箱登录。'
                  : '设置独立密码后，除第三方登录外也可使用邮箱密码登录。'}
              </p>
              <div className="space-y-4">
                {profile.placeholderEmail && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">邮箱</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                      <input
                        type="email"
                        value={credentialForm.email}
                        onChange={e => setCredentialForm(form => ({ ...form, email: e.target.value }))}
                        placeholder="you@institution.edu.cn"
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">新密码</label>
                  <div className="relative">
                    <input
                      type={showCredentialPassword ? 'text' : 'password'}
                      value={credentialForm.password}
                      onChange={e => setCredentialForm(form => ({ ...form, password: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCredentialPassword(!showCredentialPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                    >
                      {showCredentialPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">确认密码</label>
                  <input
                    type="password"
                    value={credentialForm.confirmPassword}
                    onChange={e => setCredentialForm(form => ({ ...form, confirmPassword: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                  />
                </div>
                <p className="text-xs text-gray-500">保存前需要再次确认身份。可使用验证器应用、手机短信或邮箱验证码。</p>
              </div>
              {credentialMsg && (
                <p className={`mt-3 text-sm ${credentialMsg.type === 'success' ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                  {credentialMsg.text}
                </p>
              )}
              <button
                onClick={() => void handleSetPassword()}
                disabled={credentialSaving || !credentialForm.password || !credentialForm.confirmPassword || (profile.placeholderEmail && !credentialForm.email)}
                className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {credentialSaving ? '设置中...' : '设置邮箱与密码'}
              </button>
            </div>
          )}

          {profile.hasPassword && (
          <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-4">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-900 mb-4 flex items-center gap-2">
              <Lock size={16} className="text-gray-400 dark:text-gray-500" />
              修改密码
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">当前密码</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passwordForm.currentPassword}
                    onChange={e => setPasswordForm(passwordForm => ({...passwordForm, currentPassword: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">新密码</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordForm.newPassword}
                    onChange={e => setPasswordForm(passwordForm => ({...passwordForm, newPassword: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-900 mb-1">确认新密码</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={e => setPasswordForm(passwordForm => ({...passwordForm, confirmPassword: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-400 rounded-xl text-sm text-gray-900 dark:text-slate-900 focus:outline-none focus:border-brand-400"
                />
              </div>
              <p className="text-xs text-gray-500">保存前需要再次确认身份。可使用验证器应用、手机短信或邮箱验证码。</p>
            </div>
            {passwordMsg && (
              <p className={`mt-3 text-sm ${passwordMsg.type === 'success' ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                {passwordMsg.text}
              </p>
            )}
              <button
                type="button"
              onClick={() => void handlePasswordChange()}
              disabled={passwordSaving}
              className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {passwordSaving ? '修改中...' : '修改密码'}
            </button>
          </div>
          )}
            </div>
          </div>
        </div>
      </div>

      <SiteFooter />
      <MobileBottomNav />
      <SecurityStepUpDialog
        open={stepUpAction !== null}
        action={stepUpAction ?? 'password_change'}
        title={stepUpAction === 'password_setup' ? '验证后设置密码' : '验证后修改密码'}
        description="修改密码前，需要再次确认身份。可使用验证器应用、手机短信或邮箱验证码。"
        onCancel={() => setStepUpAction(null)}
        onVerified={(grantToken) => {
          const action = stepUpAction;
          setStepUpAction(null);
          if (action === 'password_setup') void handleSetPassword(grantToken);
          if (action === 'password_change') void handlePasswordChange(grantToken);
        }}
      />
    </div>
  );
}
