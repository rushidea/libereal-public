import { createHash, randomUUID } from 'crypto';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { PREVIEW_UPLOAD_CHUNK_SIZE } from '@/lib/pricing-adjustment-preview-chunks';
import {
  commitPriceAdjustmentPlan,
  draftFilePreviewChunk,
  mergeFilePreviewDrafts,
  previewPriceAdjustment,
  type FilePreviewDraft,
  type PriceAdjustmentPreview,
} from '@/lib/pricing-adjustment-service';
import {
  MAX_PRICE_ADJUSTMENT_CATALOGS,
  parsePriceAdjustmentRequest,
  type CatalogPriceItem,
  type PriceAdjustmentRequest,
} from '@/lib/pricing-adjustment-rules';

const BATCH_TTL_MS = 60 * 60 * 1000;
const BATCH_LOCK_TTL_MS = 120 * 1000;
const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PreviewBatchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PreviewBatchError';
    this.status = status;
  }
}

type StoredRules = {
  brand: string;
  scope: PriceAdjustmentRequest['scope'];
  category: string | null;
  subcategory: string | null;
  priceField: PriceAdjustmentRequest['priceField'];
  mode: PriceAdjustmentRequest['mode'];
  direction: PriceAdjustmentRequest['direction'];
  amount: number;
  includeVariants: boolean;
  reason: string;
};

type BatchMeta = {
  ownerId: string;
  fingerprint: string;
  chunkCount: number;
  rules: StoredRules;
  received: number[];
};

type StoredChunk = {
  catalogItems: CatalogPriceItem[];
  catalogNumbers: string[];
  draft: FilePreviewDraft | null;
};

export type PreviewChunkResult = {
  batchId: string;
  chunkIndex: number;
  chunkCount: number;
  receivedCount: number;
  complete: boolean;
  chunkPreview: PriceAdjustmentPreview | null;
  preview: PriceAdjustmentPreview | null;
};

function batchKey(batchId: string): string {
  return `price-adjustment-preview-batch:${batchId}`;
}

function chunkKey(batchId: string, chunkIndex: number): string {
  return `price-adjustment-preview-batch:${batchId}:chunk:${chunkIndex}`;
}

function lockKey(batchId: string): string {
  return `price-adjustment-preview-batch-lock:${batchId}`;
}

function rulesOf(request: PriceAdjustmentRequest): StoredRules {
  return {
    brand: request.brand,
    scope: request.scope,
    category: request.category ?? null,
    subcategory: request.subcategory ?? null,
    priceField: request.priceField,
    mode: request.mode,
    direction: request.direction,
    amount: request.amount,
    includeVariants: request.includeVariants,
    reason: request.reason,
  };
}

function fingerprintOf(rules: StoredRules): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex');
}

function assembledBody(rules: StoredRules, chunks: StoredChunk[]): Record<string, unknown> {
  const catalogItems = chunks.flatMap((chunk) => chunk.catalogItems);
  const catalogNumbers = chunks.flatMap((chunk) => chunk.catalogNumbers);
  return {
    brand: rules.brand,
    scope: rules.scope,
    ...(rules.category ? { category: rules.category } : {}),
    ...(rules.subcategory ? { subcategory: rules.subcategory } : {}),
    priceField: rules.priceField,
    mode: rules.mode,
    direction: rules.direction,
    amount: rules.amount,
    includeVariants: rules.includeVariants,
    reason: rules.reason,
    ...(rules.mode === 'file'
      ? { catalogItems }
      : {
        catalogNumbers,
        ...(catalogItems.length > 0 ? { catalogItems } : {}),
      }),
  };
}

async function readMeta(batchId: string): Promise<BatchMeta | null> {
  const raw = await getEphemeralStore().get(batchKey(batchId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BatchMeta;
    if (!parsed || !Array.isArray(parsed.received) || typeof parsed.chunkCount !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readChunk(batchId: string, chunkIndex: number): Promise<StoredChunk | null> {
  const raw = await getEphemeralStore().get(chunkKey(batchId, chunkIndex));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredChunk;
    if (!parsed || !Array.isArray(parsed.catalogItems) || !Array.isArray(parsed.catalogNumbers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function ingestPreviewChunk(input: {
  ownerId: string;
  batchId?: string;
  chunkIndex: number;
  chunkCount: number;
  request: PriceAdjustmentRequest;
}): Promise<PreviewChunkResult> {
  if (input.request.scope !== 'catalog') {
    throw new PreviewBatchError('分块预览只用于导入货号', 400);
  }
  if (!Number.isInteger(input.chunkCount) || input.chunkCount < 1 || input.chunkCount > MAX_PRICE_ADJUSTMENT_CATALOGS) {
    throw new PreviewBatchError('分块数量无效', 400);
  }
  if (!Number.isInteger(input.chunkIndex) || input.chunkIndex < 0 || input.chunkIndex >= input.chunkCount) {
    throw new PreviewBatchError('分块序号无效', 400);
  }
  const itemCount = Math.max(input.request.catalogItems?.length ?? 0, input.request.catalogNumbers?.length ?? 0);
  if (itemCount > PREVIEW_UPLOAD_CHUNK_SIZE) {
    throw new PreviewBatchError(`每块最多 ${PREVIEW_UPLOAD_CHUNK_SIZE.toLocaleString('zh-CN')} 条`, 400);
  }

  const rules = rulesOf(input.request);
  const fingerprint = fingerprintOf(rules);
  const store = getEphemeralStore();
  let batchId = input.batchId?.trim() || '';
  if (batchId && !BATCH_ID_PATTERN.test(batchId)) {
    throw new PreviewBatchError('预览批次不存在或已过期，请重新生成', 404);
  }

  if (!batchId) {
    batchId = randomUUID();
    const meta: BatchMeta = {
      ownerId: input.ownerId,
      fingerprint,
      chunkCount: input.chunkCount,
      rules,
      received: [],
    };
    await store.set(batchKey(batchId), JSON.stringify(meta), BATCH_TTL_MS);
  }

  const lock = await store.acquireLock(lockKey(batchId), BATCH_LOCK_TTL_MS);
  if (!lock) throw new PreviewBatchError('预览批次正在处理上一块，请稍后重试', 409);
  try {
    const meta = await readMeta(batchId);
    if (!meta || meta.ownerId !== input.ownerId) {
      throw new PreviewBatchError('预览批次不存在或已过期，请重新生成', 404);
    }
    if (meta.chunkCount !== input.chunkCount || meta.fingerprint !== fingerprint) {
      throw new PreviewBatchError('这一块和当前预览批次的调价条件不一致，请重新生成', 409);
    }

    const draft = input.request.mode === 'file' ? await draftFilePreviewChunk(input.request) : null;
    const record: StoredChunk = {
      catalogItems: input.request.catalogItems ?? [],
      catalogNumbers: input.request.catalogNumbers ?? [],
      draft,
    };
    await store.set(chunkKey(batchId, input.chunkIndex), JSON.stringify(record), BATCH_TTL_MS);
    const received = [...new Set([...meta.received, input.chunkIndex])].sort((left, right) => left - right);
    await store.set(batchKey(batchId), JSON.stringify({ ...meta, received }), BATCH_TTL_MS);

    const stored = await Promise.all(received.map(async (index) => ({
      index,
      chunk: await readChunk(batchId, index),
    })));
    if (stored.some((entry) => !entry.chunk)) {
      throw new PreviewBatchError('预览批次不完整，请重新生成', 409);
    }
    const chunks = stored.map((entry) => entry.chunk as StoredChunk);
    const complete = received.length === meta.chunkCount;
    const chunkPreview = draft ? mergeFilePreviewDrafts([draft]).preview : null;

    if (!complete) {
      return {
        batchId,
        chunkIndex: input.chunkIndex,
        chunkCount: meta.chunkCount,
        receivedCount: received.length,
        complete: false,
        chunkPreview,
        preview: null,
      };
    }

    const assembled = parsePriceAdjustmentRequest(assembledBody(meta.rules, chunks));
    if (!assembled.ok) throw new PreviewBatchError(assembled.error, 400);

    const preview = input.request.mode === 'file'
      ? await (async () => {
        const drafts = chunks.map((chunk) => chunk.draft).filter((item): item is FilePreviewDraft => item != null);
        if (drafts.length !== chunks.length) {
          throw new PreviewBatchError('预览批次不完整，请重新生成', 409);
        }
        const merged = mergeFilePreviewDrafts(drafts);
        await commitPriceAdjustmentPlan(assembled.value, merged);
        return merged.preview;
      })()
      : await previewPriceAdjustment(assembled.value);

    return {
      batchId,
      chunkIndex: input.chunkIndex,
      chunkCount: meta.chunkCount,
      receivedCount: received.length,
      complete: true,
      chunkPreview,
      preview,
    };
  } finally {
    await store.releaseLock(lockKey(batchId), lock);
  }
}
