import type { Prisma, PrismaClient } from '@prisma/client';
import { isOrderIdUniqueConflict, isUniqueConstraintError } from '@/data/order-number';

/**
 * 公开询价号与由此询价生成的订单号共用的字符表。
 * 去掉容易和数字混淆的 I、O、0、1。共 32 个字符，256 能被 32 整除，取模没有偏差。
 */
export const PUBLIC_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 嵌在公开询价号里的短码长度。32^8，不能靠连续整数枚举。 */
export const INQUIRY_PUBLIC_CODE_LENGTH = 8;

/** 同一询价下订单号的随机短后缀。不是询价内序号本身。 */
export const INQUIRY_ORDER_SUFFIX_LENGTH = 4;

/** 询价号主键冲突时，事务内换一个新短码的次数（含第一次）。 */
export const INQUIRY_PUBLIC_ID_ATTEMPTS = 3;

/** 询价订单号冲突时，事务内重新取后缀和序号的次数（含第一次）。 */
export const INQUIRY_ORDER_NUMBER_ATTEMPTS = 3;

const PUBLIC_CODE_PATTERN = new RegExp(`^[${PUBLIC_NUMBER_ALPHABET}]{${INQUIRY_PUBLIC_CODE_LENGTH}}$`);
const ORDER_SUFFIX_PATTERN = new RegExp(`^[${PUBLIC_NUMBER_ALPHABET}]{${INQUIRY_ORDER_SUFFIX_LENGTH}}$`);

export type PublicToken = (length: number) => string;

function constraintTargets(error: { meta?: { target?: unknown } }): string[] {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.map((item) => String(item));
  if (typeof target === 'string' && target.trim()) return [target];
  return [];
}

function errorMessage(error: { message?: string }): string {
  if (typeof error.message === 'string') return error.message;
  return error instanceof Error ? error.message : '';
}

function isCheckoutAttemptConflict(error: { meta?: { target?: unknown }; message?: string }): boolean {
  const targets = constraintTargets(error);
  const message = errorMessage(error);
  return targets.some((target) => /checkoutAttemptId|checkout_attempt/i.test(target))
    || /checkoutAttemptId|checkout_attempt/i.test(message);
}

/** 询价主键撞号。幂等键 checkoutAttemptId 的唯一冲突返回 false，交给创建接口重放。 */
export function isInquiryPublicIdConflict(error: unknown): boolean {
  if (!isUniqueConstraintError(error)) return false;
  if (isCheckoutAttemptConflict(error)) return false;
  const targets = constraintTargets(error);
  if (targets.some((target) => target === 'id' || target.endsWith('.id') || target === 'PRIMARY')) return true;
  return /Unique constraint failed on the fields: \(`id`\)/.test(errorMessage(error));
}

/**
 * 询价订单号撞号：订单主键，或同一询价内的序号映射。
 * 幂等键冲突返回 false。
 */
export function isInquiryLinkedOrderConflict(error: unknown): boolean {
  if (isOrderIdUniqueConflict(error)) return true;
  if (!isUniqueConstraintError(error) || isCheckoutAttemptConflict(error)) return false;
  const targets = constraintTargets(error);
  const message = errorMessage(error);
  return targets.some((target) => /inquiryOrderSeq|inquiry_order_seq/i.test(target))
    || /inquiryOrderSeq|inquiry_order_seq/i.test(message);
}

export function inquiryPublicIdConflict(): Error & { code: 'P2002'; meta: { target: string[] } } {
  const error = new Error('Unique constraint failed on the fields: (`id`)') as Error & { code: 'P2002'; meta: { target: string[] } };
  error.code = 'P2002';
  error.meta = { target: ['id'] };
  return error;
}

/** 生成指定长度的公开短码。调用方要在事务里用唯一约束接住碰撞。 */
export function randomPublicToken(length: number): string {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('安全随机数不可用，不能生成编号');
  }
  const bytes = new Uint8Array(length);
  cryptoObj.getRandomValues(bytes);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += PUBLIC_NUMBER_ALPHABET[bytes[index] % PUBLIC_NUMBER_ALPHABET.length];
  }
  return out;
}

/** 新询价的公开编号：`INQ-` 加 8 位短码。旧的 `id_{uuid}` 不改写。 */
export function generateInquiryPublicId(token: PublicToken = randomPublicToken): string {
  const code = token(INQUIRY_PUBLIC_CODE_LENGTH);
  if (!PUBLIC_CODE_PATTERN.test(code)) {
    throw new Error('INVALID_INQUIRY_CODE');
  }
  return `INQ-${code}`;
}

export function orderNumberSharesInquiry(inquiryId: string, orderId: string): boolean {
  const prefix = `${inquiryId}-`;
  if (!inquiryId || !orderId.startsWith(prefix)) return false;
  return ORDER_SUFFIX_PATTERN.test(orderId.slice(prefix.length));
}

type InquiryOrderClient = Pick<Prisma.TransactionClient, 'order'> | Pick<PrismaClient, 'order'>;

/**
 * 在调用方事务内生成「询价号-短后缀」。
 * 后缀是随机短码；询价内第几次确认记在 inquiryOrderSeq，不出现在公开编号里。
 * 已有订单（含没有序号的旧订单）会计入下一次序号，避免映射重复。
 */
export async function allocateInquiryLinkedOrderNumber(
  db: InquiryOrderClient,
  inquiryId: string,
  token: PublicToken = randomPublicToken,
): Promise<{ orderId: string; inquiryOrderSeq: number }> {
  const rows = await db.order.findMany({
    where: { inquiryId },
    select: { inquiryOrderSeq: true },
  });
  const maxSeq = rows.reduce((max, row) => Math.max(max, row.inquiryOrderSeq ?? 0), 0);
  const inquiryOrderSeq = Math.max(maxSeq + 1, rows.length + 1);
  const suffix = token(INQUIRY_ORDER_SUFFIX_LENGTH);
  if (!ORDER_SUFFIX_PATTERN.test(suffix)) {
    throw new Error('INVALID_ORDER_SUFFIX');
  }
  return { orderId: `${inquiryId}-${suffix}`, inquiryOrderSeq };
}

/**
 * 在交互事务内分配询价公开编号并建单。主键撞号时整笔回滚后换一个短码。
 * 幂等键冲突和其他业务错误原样抛出。
 */
export async function withUniqueInquiryPublicId<TResult>(
  db: Pick<PrismaClient, '$transaction'>,
  run: (tx: Prisma.TransactionClient, inquiryId: string) => Promise<TResult>,
  token: PublicToken = randomPublicToken,
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < INQUIRY_PUBLIC_ID_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const inquiryId = generateInquiryPublicId(token);
        const clash = await tx.inquiry.findUnique({ where: { id: inquiryId }, select: { id: true } });
        if (clash) throw inquiryPublicIdConflict();
        return run(tx, inquiryId);
      });
    } catch (error) {
      lastError = error;
      if (!isInquiryPublicIdConflict(error) || attempt === INQUIRY_PUBLIC_ID_ATTEMPTS - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * 在交互事务内分配询价关联订单号并执行建单。
 * 订单主键或询价内序号撞号时整笔回滚后重新分配。幂等键冲突不重试。
 */
export async function withAllocatedInquiryOrderNumber<TResult>(
  db: Pick<PrismaClient, '$transaction'>,
  inquiryId: string,
  run: (tx: Prisma.TransactionClient, orderId: string, inquiryOrderSeq: number) => Promise<TResult>,
  token: PublicToken = randomPublicToken,
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < INQUIRY_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const allocated = await allocateInquiryLinkedOrderNumber(tx, inquiryId, token);
        const taken = await tx.order.findUnique({ where: { id: allocated.orderId }, select: { id: true } });
        if (taken) throw inquiryPublicIdConflict();
        return run(tx, allocated.orderId, allocated.inquiryOrderSeq);
      });
    } catch (error) {
      lastError = error;
      if (!isInquiryLinkedOrderConflict(error) || attempt === INQUIRY_ORDER_NUMBER_ATTEMPTS - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}
