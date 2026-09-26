import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { deletePasskey, renamePasskey } from '@/lib/security/passkey-service';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.clone().json().catch(() => null) as { name?: string } | null;
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const name = typeof body?.name === 'string' ? body.name : '';
  if (!name.trim() || name.trim().length > 80) return NextResponse.json({ error: '请输入 1 至 80 个字符的名称' }, { status: 400 });
  try {
    return NextResponse.json({ passkey: renamePasskey(user.id, id, name, await getRequestIp()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_NOT_FOUND') return NextResponse.json({ error: '通行密钥不存在或已停用' }, { status: 404 });
    if (message === 'PASSKEY_NAME_INVALID') return NextResponse.json({ error: '请输入有效的通行密钥名称' }, { status: 400 });
    console.error('[passkey.rename] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥名称修改失败' }, { status: 503 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.clone().json().catch(() => null) as { stepUpToken?: string } | null;
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  if (!body?.stepUpToken || !user.sessionId) return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
  if (!(await consumeSecurityStepUpGrant(body.stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'passkey_delete' }))) {
    return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
  }
  const { id } = await params;
  const ip = await getRequestIp();
  try {
    deletePasskey(user.id, id, ip);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_NOT_FOUND') return NextResponse.json({ error: '通行密钥不存在或已停用' }, { status: 404 });
    if (message === 'LAST_AUTHENTICATOR') return NextResponse.json({ error: '至少需要保留一个验证器' }, { status: 409 });
    console.error('[passkey.delete] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥删除暂时不可用' }, { status: 503 });
  }
}
