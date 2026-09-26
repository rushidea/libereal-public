import { generateId } from '@/lib/id';
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { Prisma } from '@prisma/client';
import { rateLimitAsync } from "@/lib/rateLimit";
import { reportError } from "@/lib/errorReporting";
import {
  clearPendingOAuthLinkCookie,
  readPendingOAuthLinkCookie,
  setPendingOAuthLinkCookie,
  upgradePendingOAuthToMerge,
} from '@/lib/account-linking';
import { MERGE_VERIFIED_COOKIE, normalizeEmail, userHasPassword } from '@/lib/auth-helpers';
import { linkPendingOAuthToUser } from '@/lib/oauth-account-link';
import { findUserByEmailCaseInsensitive } from '@/lib/user-lookup';
import {
  getRequiredLegalConsent,
  validateAcceptedLegalIds,
} from '@/lib/legal-documents';
import { normalizeChinaMobilePhone, verifySmsCode } from '@/lib/sms-verification';
import { consumeRegistrationEmailCode } from '@/lib/email-verification';
import { storePendingRegistration, type VerifiedRegistrationProfile } from '@/lib/pending-registration';
import {
  buildLegacyInstitution,
  buildLegacySchoolFields,
  isSchoolInstitutionType,
  type InstitutionProfileInput,
} from '@/data/institution-profile';

const PHONE_CHANGE_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('[verifyTurnstile] TURNSTILE_SECRET_KEY not configured');
    return false;
  }
  if (secret.startsWith('1x0000')) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[verifyTurnstile] Test key detected in production — rejecting');
      return false;
    }
    return true;
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

function canBypassTurnstileInLocalEnv(): boolean {
  if (process.env.NODE_ENV === 'production') return false;

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
  const secretKey = process.env.TURNSTILE_SECRET_KEY ?? '';
  const usesLocalSiteKey = !siteKey || siteKey.startsWith('1x0000');
  const usesLocalSecretKey = !secretKey || secretKey.startsWith('1x0000');

  return usesLocalSiteKey || usesLocalSecretKey;
}

async function buildMergedRegistrationUpdate(
  userId: string,
  input: {
    name: string;
    normalizedPhone: string;
    smsCode: string;
    profile: InstitutionProfileInput;
  },
): Promise<{ ok: true; data: Prisma.UserUpdateInput } | { ok: false; status: number; error: string }> {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, phoneLastChangedAt: true },
  });

  if (!current) {
    return { ok: false, status: 404, error: '账户不存在' };
  }

  const phoneChanged = input.normalizedPhone !== (current.phone ?? null);
  if (phoneChanged) {
    if (current.phoneLastChangedAt && Date.now() - current.phoneLastChangedAt.getTime() < PHONE_CHANGE_INTERVAL_MS) {
      return { ok: false, status: 403, error: '手机号一年内只能更改一次' };
    }

    const smsVerified = await verifySmsCode(input.normalizedPhone, input.smsCode, 'register');
    if (!smsVerified) {
      return { ok: false, status: 400, error: '短信验证码错误或已过期' };
    }
  }

  const legacy = buildLegacySchoolFields(input.profile);
  const data: Prisma.UserUpdateInput = {
    name: input.name.trim(),
    phone: input.normalizedPhone,
    institution: buildLegacyInstitution(input.profile),
    institutionType: input.profile.institutionType.trim(),
    institutionName: input.profile.institutionName.trim(),
    institutionUnit: input.profile.institutionUnit.trim(),
    department: input.profile.department.trim(),
    institutionFacility: input.profile.institutionFacility.trim(),
    school: legacy.school,
    college: legacy.college,
    major: legacy.major,
    building: legacy.building,
    piLab: input.profile.piLab.trim(),
    affiliatedLab: input.profile.affiliatedLab?.trim() || null,
  };

  if (phoneChanged) {
    data.phoneVerifiedAt = new Date();
    data.phoneLastChangedAt = new Date();
  }

  return { ok: true, data };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip') ?? 'unknown';

  try {
    const body = await req.json() as Record<string, unknown>;
    const name = text(body.name);
    const email = text(body.email);
    const emailCode = text(body.emailCode);
    const password = typeof body.password === 'string' ? body.password : '';
    const phone = text(body.phone);
    const smsCode = text(body.smsCode);
    const turnstileToken = text(body.turnstileToken);
    const acceptedLegalIds = body.acceptedLegalIds;
    const institutionType = text(body.institutionType) || (text(body.school) ? '高校' : '');
    const institutionProfile: InstitutionProfileInput = {
      institutionType,
      institutionName: text(body.institutionName) || text(body.school),
      institutionUnit: text(body.institutionUnit) || text(body.college),
      department: text(body.institutionDepartment) || text(body.department) || text(body.major),
      institutionFacility: text(body.institutionFacility) || text(body.building),
      piLab: text(body.piLab),
      affiliatedLab: text(body.affiliatedLab) || null,
    };

    if (!name || !email || !emailCode || !password || !phone || !smsCode) {
      return NextResponse.json({ error: "缺少必填信息" }, { status: 400 });
    }

    // === 注册资料结构化字段必填校验 ===
    // 学校/学院/学系/楼号/PI实验室 注册后锁定，必须如实填写
    if (!institutionProfile.institutionType || !institutionProfile.institutionName || !institutionProfile.institutionUnit || !institutionProfile.department || !institutionProfile.institutionFacility || !institutionProfile.piLab) {
      return NextResponse.json({
        error: "请完整填写机构类型、机构名称、组织单元、部门、具体单元和 PI 实验室信息（注册后不可修改）"
      }, { status: 400 });
    }

    // 旧字段由结构化资料生成，避免客户端传入的 institution 与结构化资料分叉。
    const fullInstitution = buildLegacyInstitution(institutionProfile);
    const legacyRegistration = buildLegacySchoolFields(institutionProfile);

    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少8个字符" }, { status: 400 });
    }

    const normalizedPhone = normalizeChinaMobilePhone(String(phone));
    if (!normalizedPhone) {
      return NextResponse.json({ error: '请输入有效的中国大陆手机号' }, { status: 400 });
    }

    if (!turnstileToken && !canBypassTurnstileInLocalEnv()) {
      return NextResponse.json({ error: "请先完成人机验证" }, { status: 403 });
    }

    if (turnstileToken) {
      const valid = await verifyTurnstile(turnstileToken, ip);
      if (!valid) {
        return NextResponse.json({ error: "人机验证失败，请刷新页面重试" }, { status: 403 });
      }
    }

    // Check IP registration limit
    const { allowed } = await rateLimitAsync(`register:${ip}`);
    if (!allowed) {
      return NextResponse.json(
        { error: "该IP注册次数已达上限，请稍后再试。如需帮助请联系客服。" },
        { status: 429, headers: { 'Retry-After': '300' } }
      );
    }

    const normalizedEmail = normalizeEmail(email);

    const legalAcceptedAt = new Date();
    const { requiredIds: requiredLegalIds, snapshot: legalAcceptedSnapshot } =
      await getRequiredLegalConsent('register', legalAcceptedAt);
    const legalCheck = validateAcceptedLegalIds(acceptedLegalIds, requiredLegalIds);
    if (!legalCheck.ok) {
      return NextResponse.json({ error: '请先阅读并同意全部必同意协议' }, { status: 400 });
    }

    const emailVerified = await consumeRegistrationEmailCode(normalizedEmail, String(emailCode));
    if (!emailVerified) {
      return NextResponse.json({ error: '邮箱验证码错误或已过期' }, { status: 400 });
    }

    // Check duplicate email (case-insensitive — legacy rows may differ in casing)
    const existing = await findUserByEmailCaseInsensitive(normalizedEmail);
    if (existing) {
      const pending = await readPendingOAuthLinkCookie();
      if (pending?.mode === 'register' && userHasPassword(existing.password)) {
        const pendingMerge = upgradePendingOAuthToMerge(pending, existing.id);
        const profile: VerifiedRegistrationProfile = {
          name: name.trim(),
          phone: normalizedPhone,
          institution: fullInstitution,
          fullInstitution,
          institutionType: institutionProfile.institutionType,
          institutionName: institutionProfile.institutionName,
          institutionUnit: institutionProfile.institutionUnit,
          department: institutionProfile.department,
          institutionFacility: institutionProfile.institutionFacility,
          school: legacyRegistration.school ?? '',
          college: legacyRegistration.college ?? '',
          major: legacyRegistration.major ?? '',
          building: legacyRegistration.building ?? '',
          piLab: institutionProfile.piLab,
          affiliatedLab: institutionProfile.affiliatedLab,
          acceptedLegalIds: Array.isArray(acceptedLegalIds) ? acceptedLegalIds : [],
          legalAcceptedAt: legalAcceptedAt.toISOString(),
          legalAcceptedSnapshot,
        };
        const passwordMatches = await bcrypt.compare(password, existing.password!);
        if (passwordMatches) {
          const profileUpdate = await buildMergedRegistrationUpdate(existing.id, {
            name,
            normalizedPhone,
            smsCode: String(smsCode),
            profile: institutionProfile,
          });
          if (!profileUpdate.ok) {
            return NextResponse.json({ error: profileUpdate.error }, { status: profileUpdate.status });
          }

          const linked = await linkPendingOAuthToUser(pendingMerge, existing.id);
          if (!linked.ok) {
            return NextResponse.json({ error: linked.error }, { status: 409 });
          }

          await prisma.user.update({
            where: { id: existing.id },
            data: {
              ...profileUpdate.data,
              emailVerified: new Date(),
              legalAcceptedAt,
              legalAcceptedIds: JSON.stringify(requiredLegalIds),
              legalAcceptedSnapshot: JSON.stringify(legalAcceptedSnapshot),
            },
          });

          await clearPendingOAuthLinkCookie();
          const cookieStore = await cookies();
          cookieStore.set(MERGE_VERIFIED_COOKIE, existing.id, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: 120,
          });
          const providerLabel = pending.provider === 'google' ? 'Google' : '微信';
          return NextResponse.json({
            ok: true,
            merged: true,
            email: existing.email,
            message: `${providerLabel} 账号已成功合并到您的账户`,
          });
        }

        const profileUpdate = await buildMergedRegistrationUpdate(existing.id, {
          name,
          normalizedPhone,
          smsCode: String(smsCode),
          profile: institutionProfile,
        });
        if (!profileUpdate.ok) {
          return NextResponse.json({ error: profileUpdate.error }, { status: profileUpdate.status });
        }

        const registrationToken = await storePendingRegistration(existing.id, profile);
        await setPendingOAuthLinkCookie({ ...pendingMerge, registrationToken });
        const providerLabel = pending.provider === 'google' ? 'Google' : '微信';
        return NextResponse.json(
          {
            error: `该邮箱已注册，请输入已有账户密码以绑定${providerLabel}并合并账户`,
            code: 'merge_required',
            redirect: `/login/merge?provider=${pending.provider}&email=${encodeURIComponent(existing.email)}`,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "该邮箱已注册，请直接登录或使用其他邮箱" }, { status: 409 });
    }

    const smsVerified = await verifySmsCode(normalizedPhone, String(smsCode), 'register');
    if (!smsVerified) {
      return NextResponse.json({ error: '短信验证码错误或已过期' }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 12);
    const id = generateId('usr');

    await prisma.user.create({
      data: {
        id,
        name,
        email: normalizedEmail,
        password: hashed,
        emailVerified: new Date(),
        phone: normalizedPhone,
        phoneVerifiedAt: new Date(),
        phoneLastChangedAt: new Date(),
        institution: fullInstitution,
        institutionType: institutionProfile.institutionType,
        institutionName: institutionProfile.institutionName,
        institutionUnit: institutionProfile.institutionUnit,
        department: institutionProfile.department,
        institutionFacility: institutionProfile.institutionFacility,
        school: isSchoolInstitutionType(institutionProfile.institutionType) ? institutionProfile.institutionName : null,
        college: isSchoolInstitutionType(institutionProfile.institutionType) ? institutionProfile.institutionUnit : null,
        major: isSchoolInstitutionType(institutionProfile.institutionType) ? institutionProfile.department : null,
        building: isSchoolInstitutionType(institutionProfile.institutionType) ? institutionProfile.institutionFacility : null,
        piLab: institutionProfile.piLab,
        affiliatedLab: institutionProfile.affiliatedLab,
        role: 'customer',
        points: 0,
        tier: 'standard',
        legalAcceptedAt,
        legalAcceptedIds: JSON.stringify(requiredLegalIds),
        legalAcceptedSnapshot: JSON.stringify(legalAcceptedSnapshot),
      },
    });

    // Notify admin of new user registration
    await prisma.notification.create({
      data: {
        email: 'admin',
        role: 'admin',
        type: 'inquiry_received',
        title: '新用户注册',
        content: `新用户注册：${name}（${email}），手机：${normalizedPhone}，机构：${fullInstitution}${institutionProfile.affiliatedLab ? `，依托实验室：${institutionProfile.affiliatedLab}` : ''}`,
        linkUrl: '/admin/users',
        metadata: JSON.stringify({ userId: id }),
      },
    });

    // Allow immediate credentials signIn without a second Turnstile challenge
    // (registration already verified Turnstile; tokens are single-use).
    const cookieStore = await cookies();
    cookieStore.set(MERGE_VERIFIED_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 120,
    });

    return NextResponse.json({ id, email: normalizedEmail, name }, { status: 201 });
  } catch (err) {
    reportError(err, { tags: { route: "register" } });
    return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
  }
}
