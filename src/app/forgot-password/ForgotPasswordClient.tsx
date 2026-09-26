'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, AlertCircle, ArrowLeft, CheckCircle, Phone, MessageSquare } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

function ForgotPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetEmail = searchParams.get('email') ?? '';

  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState(presetEmail);
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (smsCountdown <= 0) return;
    const timer = window.setTimeout(() => setSmsCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [smsCountdown]);

  const sendSmsCode = async () => {
    setError('');
    if (!phone.trim()) {
      setError('请先填写已验证手机号');
      return;
    }
    setSmsSending(true);
    try {
      const res = await fetch('/api/auth/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'reset-password' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '验证码发送失败，请重试');
        return;
      }
      setSmsCountdown(60);
    } catch {
      setError('验证码发送失败，请重试');
    } finally {
      setSmsSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const body = method === 'email'
        ? { method, email: email.trim() }
        : { method, phone, smsCode };
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '发送失败，请重试');
        return;
      }

      if (method === 'phone' && data.resetToken) {
        router.replace(`/reset-password?token=${encodeURIComponent(data.resetToken)}`);
        return;
      }

      setSent(true);
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/50 p-8">
            {sent ? (
              <div className="text-center">
                <CheckCircle className="w-12 h-12 text-brand-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-900 mb-2">请查收邮件</h1>
                <p className="text-sm text-gray-500 leading-relaxed">
                  如果该邮箱已注册，重置链接已发送至您的邮箱。链接 24 小时内有效，请检查收件箱与垃圾邮件文件夹。
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 mt-6 text-sm text-brand-600 hover:text-brand-700 font-medium"
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回登录
                </Link>
              </div>
            ) : (
              <>
                <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold text-gray-900 mb-1">忘记密码</h1>
                  <p className="text-gray-500 text-sm">选择邮箱链接或已验证手机号完成找回</p>
                </div>

                {error && (
                  <div className="mb-5 flex items-center gap-2 bg-red-100/70 backdrop-blur-sm border border-red-200/50 text-red-600 rounded-xl px-4 py-3 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="mb-5 grid grid-cols-2 rounded-xl bg-gray-100/80 p-1">
                  <button
                    type="button"
                    onClick={() => { setMethod('email'); setError(''); }}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${method === 'email' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    邮箱找回
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMethod('phone'); setError(''); }}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${method === 'phone' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    手机找回
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {method === 'email' ? (
                    <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="you@institution.edu.cn"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full border border-white/50 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-800 bg-white/60 backdrop-blur-sm focus:bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                      />
                    </div>
                    </div>
                  ) : (
                    <>

                      <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">已验证手机号</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="tel"
                        required
                        inputMode="tel"
                        placeholder="注册账户绑定的手机号"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full border border-white/50 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-800 bg-white/60 backdrop-blur-sm focus:bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                      />
                    </div>
                      </div>

                      <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">短信验证码</label>
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          required
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="6 位验证码"
                          value={smsCode}
                          onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="w-full border border-white/50 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-800 bg-white/60 backdrop-blur-sm focus:bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={sendSmsCode}
                        disabled={smsSending || smsCountdown > 0}
                        className="flex-shrink-0 rounded-xl border border-brand-200 bg-white/70 px-3 text-sm font-medium text-brand-700 disabled:text-gray-400"
                      >
                        {smsSending ? '发送中' : smsCountdown > 0 ? `${smsCountdown}s` : '获取验证码'}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">安全验证码每天最多发送 3 次。</p>
                      </div>
                    </>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-brand-500/90 backdrop-blur-sm hover:bg-brand-600 disabled:bg-brand-300/50 text-white py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md"
                  >
                    {loading ? (
                      <>
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        {method === 'email' ? '发送中...' : '验证中...'}
                      </>
                    ) : (
                      method === 'email' ? '发送重置链接' : '验证并设置新密码'
                    )}
                  </button>
                </form>
              </>
            )}
          </div>

          {!sent && (
            <div className="mt-4 text-center">
              <Link
                href="/login"
                className="text-sm text-gray-400 hover:text-brand-600 flex items-center justify-center gap-1"
              >
                <ArrowLeft className="w-4 h-4" /> 返回登录
              </Link>
            </div>
          )}
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

export default function ForgotPasswordClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
