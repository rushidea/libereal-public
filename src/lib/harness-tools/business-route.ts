import { NextRequest, NextResponse } from 'next/server';
import { PurchaseError } from '@/lib/purchase-terms';
import {
  authorizeHarnessBusinessObject, harnessError, rejectUntrustedAuthFields, sha256Hex, type HarnessBusinessScope,
} from './auth';
import { HarnessServiceError, mapHarnessServiceError } from './inquiry-tools-service';

type Fields = Record<string, unknown>;
type Params = { params: Promise<{ id: string }> };
type ScopeContext = { pilotOrderIds: readonly string[] };
type Result = { objectVersion: string; data: unknown };
type BusinessRead = (id: string, context: ScopeContext) => Promise<Result>;
type BusinessPreview = (id: string, context: ScopeContext, input: Fields, expectedVersion: string) => Promise<Result>;

const HASH = /^[a-f0-9]{64}$/;
const OBJECT_ID = /^[A-Za-z0-9._-]{1,160}$/;
const MAX_BODY_BYTES = 16_384;

export function invalidBusinessInput(): never {
  throw new HarnessServiceError(400, 'validation_error', 'INVALID_INPUT', '业务工具请求字段或格式无效');
}

export function businessObjectId(value: unknown): string {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) invalidBusinessInput();
  return value;
}

export function strictFields(value: unknown, fields: readonly string[]): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    invalidBusinessInput();
  }
  return value as Fields;
}

export function assertBusinessVersion(actual: string, expected: string) {
  if (actual !== expected) {
    throw new HarnessServiceError(409, 'version_conflict', 'OBJECT_VERSION_CHANGED', '单据或依据已变化，请重新读取并核对');
  }
}

function previewKey(tool: string, id: string, input: Fields) {
  return sha256Hex(JSON.stringify([tool, id, input], (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Fields)[key]]));
  }));
}

async function readBody(req: NextRequest): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) return invalidBusinessInput();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let raw = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(raw + decoder.decode()) as unknown;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HarnessServiceError(413, 'validation_error', 'BODY_TOO_LARGE', '业务工具请求体过大');
      }
      raw += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof HarnessServiceError) throw error;
    invalidBusinessInput();
  } finally {
    reader.releaseLock();
  }
}

type ReadOptions = { tool: string; scope: HarnessBusinessScope; run: BusinessRead };
type PreviewOptions = { tool: string; scope: HarnessBusinessScope; fields: readonly string[]; run: BusinessPreview };

function businessRoute(options: ReadOptions | PreviewOptions) {
  return async function handler(req: NextRequest, { params }: Params) {
    const { id } = await params;
    const auth = authorizeHarnessBusinessObject(req, options.scope, id);
    if (!auth.ok) return auth.response;
    const context = { pilotOrderIds: auth.pilotOrderIds ?? [] };
    try {
      if (req.nextUrl.search) invalidBusinessInput();
      let result: Result;
      let requestKey: string | undefined;
      if ('fields' in options) {
        const raw = await readBody(req);
        const untrusted = rejectUntrustedAuthFields(raw);
        if (untrusted) return untrusted;
        const { idempotencyKey, expectedVersion, ...input } = strictFields(raw, ['idempotencyKey', 'expectedVersion', ...options.fields]);
        if (typeof expectedVersion !== 'string' || !HASH.test(expectedVersion) ||
          typeof idempotencyKey !== 'string' || !HASH.test(idempotencyKey)) invalidBusinessInput();
        // This preview is read-only. Bind each retry key to the whole intent without storing a reservation.
        if (idempotencyKey !== previewKey(options.tool, id, { expectedVersion, ...input })) {
          return harnessError(409, 'idempotency_conflict', 'PREVIEW_KEY_MISMATCH', '预览操作编号与本次请求内容不符');
        }
        requestKey = idempotencyKey;
        result = await options.run(id, context, input, expectedVersion);
      } else {
        result = await options.run(id, context);
      }
      return NextResponse.json({
        ok: true, tool: options.tool, environment: auth.principal.environment,
        clientId: auth.principal.clientId, readAt: new Date().toISOString(), ...result,
        ...(requestKey ? { requestKey } : {}),
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (error instanceof PurchaseError) {
        if (error.status === 400) return harnessError(400, 'validation_error', 'INVALID_PURCHASE_INPUT', '采购预览字段无效');
        if (error.status === 409) return harnessError(409, 'version_conflict', 'PURCHASE_CONTEXT_CHANGED', '采购单或依据已变化，请重新核对');
      }
      const mapped = mapHarnessServiceError(error);
      if (mapped.status >= 500) console.error(`[harness ${options.tool}] ${error instanceof Error ? error.name : 'UnknownError'}`);
      return harnessError(mapped.status, mapped.errorClass, mapped.code, mapped.message, mapped.retryable, mapped.details);
    }
  };
}

export const harnessBusinessRead = (options: ReadOptions) => businessRoute(options);
export const harnessBusinessPreview = (options: PreviewOptions) => businessRoute(options);
