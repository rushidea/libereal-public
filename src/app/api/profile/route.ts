import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { isPlaceholderOAuthEmail, userHasPassword } from '@/lib/auth-helpers';
import { normalizeChinaMobilePhone, verifySmsCode } from '@/lib/sms-verification';

const PHONE_CHANGE_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;

  if (!userId || !email) {
    return NextResponse.json({ profile: null });
  }

  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true, email: true, phone: true, phoneVerifiedAt: true, phoneLastChangedAt: true, institution: true, department: true,
        institutionType: true, institutionName: true, institutionUnit: true, institutionFacility: true,
        identity: true, advisorName: true, advisorPhone: true, avatar: true,
        school: true, college: true, major: true, building: true, piLab: true, affiliatedLab: true,
        password: true,
        wechatNickname: true, displayAvatarUrl: true,
        accounts: {
          select: { provider: true },
        },
      },
    });

    if (!row) {
      return NextResponse.json({ profile: null });
    }

    const linkedProviders = row.accounts.map((account) => account.provider);
    const googleLinked = linkedProviders.includes('google');
    const wechatLinked = linkedProviders.includes('wechat');
    const hasPassword = userHasPassword(row.password);
    const placeholderEmail = isPlaceholderOAuthEmail(row.email);

    return NextResponse.json({
      profile: {
        name: row.name ?? '',
        email: row.email ?? email,
        phone: row.phone ?? '',
        phoneVerified: Boolean(row.phoneVerifiedAt),
        phoneVerifiedAt: row.phoneVerifiedAt?.toISOString() ?? null,
        phoneLastChangedAt: row.phoneLastChangedAt?.toISOString() ?? null,
        institution: row.institution ?? '',
        department: row.department ?? '',
        institutionType: row.institutionType ?? '',
        institutionName: row.institutionName ?? '',
        institutionUnit: row.institutionUnit ?? '',
        institutionFacility: row.institutionFacility ?? '',
        identity: row.identity ?? '',
        advisorName: row.advisorName ?? '',
        advisorPhone: row.advisorPhone ?? '',
        avatar: row.avatar ?? '',
        school: row.school ?? '',
        college: row.college ?? '',
        major: row.major ?? '',
        building: row.building ?? '',
        piLab: row.piLab ?? '',
        affiliatedLab: row.affiliatedLab ?? '',
        wechatNickname: row.wechatNickname ?? '',
        displayAvatarUrl: row.displayAvatarUrl ?? '',
        googleLinked,
        wechatLinked,
        hasPassword,
        placeholderEmail,
        linkedProviders,
        credentialsEnabled: hasPassword,
      }
    });
  } catch (err) {
    console.error('[profile API] error:', err);
    return NextResponse.json({ profile: null });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, phone, smsCode, wechatNickname, displayAvatarUrl } = body;
    // institution, department, identity, advisorName, advisorPhone, school, college, major, building, piLab, affiliatedLab
    // are LOCKED at registration time — cannot be updated from settings.

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, phoneLastChangedAt: true },
    });

    if (!current) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const normalizedPhone = typeof phone === 'string' && phone.trim()
      ? normalizeChinaMobilePhone(phone)
      : null;
    if (phone && !normalizedPhone) {
      return NextResponse.json({ error: '请输入有效的中国大陆手机号' }, { status: 400 });
    }

    const phoneChanged = normalizedPhone !== (current.phone ?? null);
    if (phoneChanged) {
      if (current.phoneLastChangedAt && Date.now() - current.phoneLastChangedAt.getTime() < PHONE_CHANGE_INTERVAL_MS) {
        return NextResponse.json({ error: '手机号一年内只能更改一次' }, { status: 403 });
      }
      if (!smsCode || !normalizedPhone || !(await verifySmsCode(normalizedPhone, String(smsCode), 'phone-change'))) {
        return NextResponse.json({ error: '请先完成新手机号短信验证' }, { status: 400 });
      }
    }

    const updateData: Prisma.UserUpdateInput = {
      name: name ?? null,
      phone: normalizedPhone,
      wechatNickname: wechatNickname ?? null,
      displayAvatarUrl: displayAvatarUrl ?? null,
    };

    if (phoneChanged) {
      updateData.phoneVerifiedAt = new Date();
      updateData.phoneLastChangedAt = new Date();
    }

    await prisma.user.update({ where: { id: userId }, data: updateData });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[profile PUT] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
