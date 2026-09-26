import { generateId } from './id';
import { prisma } from './prisma';
import type { PendingOAuthLink } from './account-linking';
import { isOAuthAvatarUrl, normalizeEmail, wechatProfileUpdates } from './auth-helpers';

export async function linkPendingOAuthToUser(
  pending: PendingOAuthLink,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existingLink = await prisma.account.findFirst({
    where: {
      provider: pending.provider,
      providerAccountId: pending.providerAccountId,
    },
    select: { id: true, userId: true },
  });

  if (existingLink && existingLink.userId !== userId) {
    return { ok: false, error: '该第三方账号已绑定其他账户' };
  }

  if (!existingLink) {
    await prisma.account.create({
      data: {
        id: generateId('acc'),
        userId,
        type: pending.type ?? 'oauth',
        provider: pending.provider,
        providerAccountId: pending.providerAccountId,
        refresh_token: pending.refresh_token ?? null,
        access_token: pending.access_token ?? null,
        expires_at: pending.expires_at ?? null,
        token_type: pending.token_type ?? null,
        scope: pending.scope ?? null,
        id_token: pending.id_token ?? null,
        session_state: pending.session_state ?? null,
      },
    });
  }

  const userUpdate: {
    googleEmail?: string;
    avatar?: string;
    name?: string;
    wechatNickname?: string;
    displayAvatarUrl?: string;
    sex?: number;
  } = {};

  if (pending.provider === 'google' && pending.oauthEmail) {
    userUpdate.googleEmail = normalizeEmail(pending.oauthEmail);
    if (isOAuthAvatarUrl(pending.oauthImage)) {
      userUpdate.avatar = pending.oauthImage;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { displayAvatarUrl: true },
      });
      if (!user?.displayAvatarUrl?.trim()) {
        userUpdate.displayAvatarUrl = pending.oauthImage;
      }
    }
  }

  if (pending.provider === 'wechat' && (pending.oauthName || pending.oauthImage || pending.oauthSex != null)) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, wechatNickname: true, displayAvatarUrl: true, sex: true },
    });
    if (user) {
      Object.assign(
        userUpdate,
        wechatProfileUpdates(user, {
          name: pending.oauthName,
          image: pending.oauthImage,
          sex: pending.oauthSex,
        }),
      );
    }
  }

  if (Object.keys(userUpdate).length > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: userUpdate,
    });
  }

  return { ok: true };
}
