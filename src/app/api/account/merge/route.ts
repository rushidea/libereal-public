import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import {
  clearPendingOAuthLinkCookie,
  providerLabel,
  readPendingOAuthLinkCookie,
  type LinkProvider,
} from '@/lib/account-linking';
import { MERGE_VERIFIED_COOKIE, normalizeEmail, userHasPassword } from '@/lib/auth-helpers';
import { linkPendingOAuthToUser } from '@/lib/oauth-account-link';
import { consumePendingRegistration } from '@/lib/pending-registration';
import { buildLegacyInstitution, buildLegacySchoolFields, type InstitutionProfileInput } from '@/data/institution-profile';

export async function GET() {
  const pending = await readPendingOAuthLinkCookie();

  if (!pending || pending.mode !== 'merge' || !pending.targetUserId) {
    return NextResponse.json({ pending: null });
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.targetUserId },
    select: { email: true },
  });

  if (!user) {
    return NextResponse.json({ pending: null });
  }

  return NextResponse.json({
    pending: {
      provider: pending.provider,
      providerLabel: providerLabel(pending.provider),
      email: user.email,
      oauthEmail: pending.oauthEmail ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const pending = await readPendingOAuthLinkCookie();

    if (!pending || pending.mode !== 'merge' || !pending.targetUserId) {
      return NextResponse.json({ error: '没有待合并的登录请求，请重新尝试第三方登录' }, { status: 400 });
    }

    const { password } = await req.json() as { password?: string };

    if (!password) {
      return NextResponse.json({ error: '请输入密码' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: pending.targetUserId },
      select: { id: true, email: true, password: true },
    });

    if (!user || !userHasPassword(user.password)) {
      return NextResponse.json({ error: '账户不存在或未设置密码' }, { status: 404 });
    }

    const valid = await bcrypt.compare(password, user.password!);
    if (!valid) {
      return NextResponse.json({ error: '密码错误，无法合并账户' }, { status: 401 });
    }

    if (pending.provider === 'google' && pending.oauthEmail) {
      const oauthEmail = normalizeEmail(pending.oauthEmail);
      if (normalizeEmail(user.email) !== oauthEmail) {
        const emailOwner = await prisma.user.findFirst({
          where: {
            OR: [{ email: oauthEmail }, { googleEmail: oauthEmail }],
            NOT: { id: user.id },
          },
          select: { id: true },
        });
        if (emailOwner) {
          return NextResponse.json({ error: '该 Google 邮箱已被其他账户使用' }, { status: 409 });
        }
      }
    }

    const linked = await linkPendingOAuthToUser(pending, user.id);
    if (!linked.ok) {
      return NextResponse.json({ error: linked.error }, { status: 409 });
    }

    const registration = await consumePendingRegistration(user.id, pending.registrationToken);
    if (registration) {
      const institutionProfile: InstitutionProfileInput = {
        institutionType: registration.institutionType?.trim() || (registration.school.trim() ? '高校' : '待补充'),
        institutionName: registration.institutionName?.trim() || registration.school.trim() || registration.fullInstitution.trim(),
        institutionUnit: registration.institutionUnit?.trim() || registration.college.trim(),
        department: registration.department?.trim() || registration.major.trim(),
        institutionFacility: registration.institutionFacility?.trim() || registration.building.trim(),
        piLab: registration.piLab.trim(),
        affiliatedLab: registration.affiliatedLab?.trim() || null,
      };
      const legacy = buildLegacySchoolFields(institutionProfile);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          name: registration.name.trim(),
          phone: registration.phone,
          phoneVerifiedAt: new Date(),
          phoneLastChangedAt: new Date(),
          institution: buildLegacyInstitution(institutionProfile),
          institutionType: institutionProfile.institutionType,
          institutionName: institutionProfile.institutionName,
          institutionUnit: institutionProfile.institutionUnit,
          department: institutionProfile.department,
          institutionFacility: institutionProfile.institutionFacility,
          school: legacy.school,
          college: legacy.college,
          major: legacy.major,
          building: legacy.building,
          piLab: institutionProfile.piLab,
          affiliatedLab: institutionProfile.affiliatedLab,
          emailVerified: new Date(),
          legalAcceptedAt: registration.legalAcceptedAt
            ? new Date(registration.legalAcceptedAt)
            : new Date(),
          legalAcceptedIds: JSON.stringify(registration.acceptedLegalIds),
          legalAcceptedSnapshot: registration.legalAcceptedSnapshot
            ? JSON.stringify(registration.legalAcceptedSnapshot)
            : null,
        },
      });
    }

    await clearPendingOAuthLinkCookie();

    const cookieStore = await cookies();
    cookieStore.set(MERGE_VERIFIED_COOKIE, user.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 120,
    });

    return NextResponse.json({
      ok: true,
      provider: pending.provider as LinkProvider,
      email: user.email,
      message: `${providerLabel(pending.provider)} 账号已成功合并到您的账户`,
    });
  } catch (err) {
    console.error('[account/merge]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
