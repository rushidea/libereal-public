import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import {
  CUSTOMER_IDENTITY_OPTIONS,
  INTERNAL_IDENTITY_OPTIONS,
  customerCanChooseIdentity,
  parseCustomerIdentityChoice,
} from '@/lib/identity-options';

const ASSIGNED_IDENTITIES = [...CUSTOMER_IDENTITY_OPTIONS, ...INTERNAL_IDENTITY_OPTIONS];

/**
 * 客户自选身份，只能设置一次。
 * 权限：本人登录（有效会话）。只更新当前登录用户，忽略请求里的 userId。
 * 只接受客户可选身份。管理员账户、当前身份已在客户可选列表中，或是内部角色时，拒绝修改。
 */
export async function PUT(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式无效' }, { status: 400 });
  }

  const submitted = body && typeof body === 'object' && 'identity' in body
    ? (body as { identity: unknown }).identity
    : undefined;
  const choice = parseCustomerIdentityChoice(submitted);
  if (!choice) {
    return NextResponse.json({ error: '请选择有效的身份' }, { status: 400 });
  }

  const current = await prisma.user.findUnique({
    where: { id: activeUser.id },
    select: { id: true, identity: true, role: true },
  });
  if (!current) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }
  if (current.role === 'admin') {
    return NextResponse.json({ error: '管理员账户不能自选身份' }, { status: 403 });
  }
  if (!customerCanChooseIdentity(current.identity)) {
    return NextResponse.json({ error: '身份已设置，如需修改请联系客服' }, { status: 403 });
  }

  const updated = await prisma.user.updateMany({
    where: {
      id: activeUser.id,
      role: { not: 'admin' },
      OR: [
        { identity: null },
        { identity: '' },
        { identity: { notIn: ASSIGNED_IDENTITIES } },
      ],
    },
    data: { identity: choice },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ error: '身份已设置，如需修改请联系客服' }, { status: 403 });
  }

  return NextResponse.json({ success: true, identity: choice });
}
