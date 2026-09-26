import { NextRequest, NextResponse } from 'next/server';
import { generateId } from '@/lib/id';
import { prisma } from '@/lib/prisma';
import {
  exchangeWechatMiniCode,
  getWechatMiniLoginTokenExpiresAt,
  normalizeMiniProgramSex,
  normalizeWechatMiniProviderAccountId,
  WECHAT_MINI_CHALLENGE_STATUSES,
} from '@/lib/wechat-mini-auth';
import { wechatProfileUpdates } from '@/lib/auth-helpers';

type ConfirmPayload = {
  challengeId?: string;
  code?: string;
  nickName?: string;
  avatarUrl?: string;
  gender?: number;
};

function getReviewChallengeId() {
  return process.env.WECHAT_MINI_REVIEW_CHALLENGE_ID?.trim() || 'wmc_review_audit';
}

function isReviewModeEnabled() {
  return process.env.WECHAT_MINI_REVIEW_MODE === '1';
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as ConfirmPayload;
    const challengeId = payload.challengeId?.trim();
    const code = payload.code?.trim();

    if (!challengeId || !code) {
      return NextResponse.json({ error: '缺少 challengeId 或微信登录 code' }, { status: 400 });
    }

    if (isReviewModeEnabled() && challengeId === getReviewChallengeId()) {
      await exchangeWechatMiniCode(code);
      return NextResponse.json({
        ok: true,
        status: 'review',
        message: '登录成功。',
      });
    }

    const challenge = await prisma.wechatMiniLoginChallenge.findUnique({
      where: { id: challengeId },
      select: { id: true, status: true, expiresAt: true },
    });

    if (!challenge || challenge.status !== WECHAT_MINI_CHALLENGE_STATUSES.pending) {
      return NextResponse.json({ error: '登录请求不存在或已处理' }, { status: 404 });
    }
    if (challenge.expiresAt <= new Date()) {
      await prisma.wechatMiniLoginChallenge.update({
        where: { id: challenge.id },
        data: { status: WECHAT_MINI_CHALLENGE_STATUSES.expired },
      });
      return NextResponse.json({ error: '登录请求已过期，请重新尝试' }, { status: 410 });
    }

    const session = await exchangeWechatMiniCode(code);
    const providerAccountId = normalizeWechatMiniProviderAccountId(session);
    const linked = await prisma.account.findFirst({
      where: {
        provider: 'wechat',
        providerAccountId,
      },
      select: { userId: true },
    });

    const oauthName = payload.nickName?.trim() || null;
    const oauthImage = payload.avatarUrl?.trim() || null;
    const oauthSex = normalizeMiniProgramSex(payload.gender);

    if (linked) {
      const existingUser = await prisma.user.findUnique({
        where: { id: linked.userId },
        select: { name: true, wechatNickname: true, displayAvatarUrl: true, sex: true },
      });
      const profileUpdate = existingUser
        ? wechatProfileUpdates(existingUser, { name: oauthName, image: oauthImage, sex: oauthSex })
        : {};
      await prisma.wechatMiniLoginChallenge.update({
        where: { id: challenge.id },
        data: {
          status: WECHAT_MINI_CHALLENGE_STATUSES.linked,
          providerAccountId,
          userId: linked.userId,
          loginToken: generateId('wmt'),
          oauthName,
          oauthImage,
          oauthSex,
          expiresAt: getWechatMiniLoginTokenExpiresAt(),
        },
      });
      if (Object.keys(profileUpdate).length > 0) {
        await prisma.user.update({ where: { id: linked.userId }, data: profileUpdate });
      }
      return NextResponse.json({ ok: true, status: WECHAT_MINI_CHALLENGE_STATUSES.linked });
    }

    await prisma.wechatMiniLoginChallenge.update({
      where: { id: challenge.id },
      data: {
        status: WECHAT_MINI_CHALLENGE_STATUSES.unlinked,
        providerAccountId,
        oauthName,
        oauthImage,
        oauthSex,
      },
    });
    return NextResponse.json({ ok: true, status: WECHAT_MINI_CHALLENGE_STATUSES.unlinked });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[wechat-mini/confirm]', error);
    if (message === 'WECHAT_MINI_NOT_CONFIGURED') {
      return NextResponse.json({ error: '微信小程序 AppID/Secret 尚未配置' }, { status: 503 });
    }
    if (message.startsWith('WECHAT_MINI_CODE_EXCHANGE_FAILED:')) {
      return NextResponse.json({ error: '微信小程序登录凭证校验失败' }, { status: 502 });
    }
    return NextResponse.json({ error: '微信小程序登录失败' }, { status: 500 });
  }
}
