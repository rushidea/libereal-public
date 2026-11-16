import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SecurityStepUpDialog from '@/components/security/SecurityStepUpDialog';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('security step-up dialog', () => {
  it('clearly labels simulation and restarts an expired challenge before continuing once', async () => {
    const onVerified = vi.fn(); let begun = 0; let verified = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ methods: ['staging_test', 'email'], preferredMethod: 'staging_test' });
      const body = JSON.parse(String(init.body));
      expect(body.action).toBe('admin_sensitive'); expect(body.method).toBe('staging_test');
      if (!body.challengeId) return Response.json({ challengeId: `challenge-${++begun}` });
      verified++;
      if (verified === 1) return Response.json({ error: '验证码已过期，请重新获取。' }, { status: 410 });
      expect(body.challengeId).toBe('challenge-2');
      return Response.json({ grantToken: 'one-scoped-test-grant' });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SecurityStepUpDialog open action="admin_sensitive" title="管理员身份确认" description="确认后继续已批准的操作" onCancel={vi.fn()} onVerified={onVerified} />);
    expect(await screen.findByRole('button', { name: '测试口令' })).toBeTruthy();
    expect(screen.getByText(/当前为测试环境/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始验证' }));
    fireEvent.change(await screen.findByLabelText('固定测试口令'), { target: { value: '825174' } });
    fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('验证码已过期');
    expect(onVerified).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始验证' }));
    const input = await screen.findByLabelText('固定测试口令'); expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: '825174' } });
    fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledExactlyOnceWith('one-scoped-test-grant'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/security/step-up?action=admin_sensitive');
  });

  it('keeps a wrong-code challenge available and exposes no simulated option in normal mode', async () => {
    const onVerified = vi.fn(); let codeAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ methods: ['email'], preferredMethod: 'email' });
      const body = JSON.parse(String(init.body));
      if (!body.challengeId) return Response.json({ challengeId: 'email-challenge' });
      if (++codeAttempts === 1) return Response.json({ error: '验证码错误。' }, { status: 400 });
      expect(body.challengeId).toBe('email-challenge');
      return Response.json({ grantToken: 'normal-grant' });
    }));
    render(<SecurityStepUpDialog open action="admin_sensitive" title="管理员身份确认" description="确认后继续" onCancel={vi.fn()} onVerified={onVerified} />);
    fireEvent.click(await screen.findByRole('button', { name: '发送邮箱验证码' }));
    expect(screen.queryByText('测试口令')).toBeNull();
    fireEvent.change(await screen.findByLabelText('邮箱验证码'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('验证码错误');
    expect(onVerified).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '825174' } });
    fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledExactlyOnceWith('normal-grant'));
  });
});
