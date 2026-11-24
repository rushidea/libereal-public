import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { NextResponse } from 'next/server';

export const HARNESS_TOOL_SCOPES = [
  'inquiry.read',
  'inquiry.quote.preview',
  'inquiry.supplier_review.prepare',
] as const;

export type HarnessToolScope = (typeof HARNESS_TOOL_SCOPES)[number];

export type HarnessErrorClass =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'missing_info'
  | 'awaiting_human'
  | 'validation_error'
  | 'disabled'
  | 'internal_error';

export const HARNESS_HEADER_TOKEN = 'x-libereal-harness-token';
export const HARNESS_HEADER_CLIENT_ID = 'x-libereal-harness-client-id';
export const HARNESS_HEADER_ENV = 'x-libereal-harness-env';

const UNTRUSTED_AUTHORIZATION_FIELDS = new Set([
  'approved',
  'isApproved',
  'adminId',
  'actorId',
  'actorEmail',
  'role',
  'permissions',
  'bypass',
  'bypassApproval',
  'force',
  'mfaVerified',
  'stepUpToken',
]);

export interface HarnessClientConfig {
  clientId: string;
  tokenSha256: string;
  scopes: HarnessToolScope[];
  expiresAt?: string;
  revoked?: boolean;
}

export interface HarnessToolsConfig {
  enabled: boolean;
  environment: string;
  pilotInquiryIds?: string[];
  clients: HarnessClientConfig[];
}

export interface HarnessPrincipal {
  clientId: string;
  environment: string;
  scopes: readonly HarnessToolScope[];
}

const SCOPE_SET = new Set<string>(HARNESS_TOOL_SCOPES);
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ENV_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function constantTimeHexMatch(providedHex: string, expectedHex: string): boolean {
  if (!SHA256_HEX_RE.test(providedHex) || !SHA256_HEX_RE.test(expectedHex)) {
    return false;
  }
  const left = Buffer.from(providedHex, 'hex');
  const right = Buffer.from(expectedHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseHarnessToolsConfig(raw: unknown): HarnessToolsConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return null;
  if (typeof obj.environment !== 'string' || !ENV_NAME_RE.test(obj.environment)) return null;

  let pilotInquiryIds: string[] | undefined;
  if (obj.pilotInquiryIds !== undefined) {
    if (!Array.isArray(obj.pilotInquiryIds) || obj.pilotInquiryIds.some((id) => typeof id !== 'string' || !id.trim())) {
      return null;
    }
    pilotInquiryIds = obj.pilotInquiryIds.map((id) => (id as string).trim());
  }

  if (!Array.isArray(obj.clients)) return null;
  const clients: HarnessClientConfig[] = [];
  for (const entry of obj.clients) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const client = entry as Record<string, unknown>;
    if (typeof client.clientId !== 'string' || !CLIENT_ID_RE.test(client.clientId)) return null;
    if (typeof client.tokenSha256 !== 'string' || !SHA256_HEX_RE.test(client.tokenSha256)) return null;
    if (!Array.isArray(client.scopes) || client.scopes.some((s) => typeof s !== 'string' || !SCOPE_SET.has(s))) {
      return null;
    }
    if (client.expiresAt !== undefined && (typeof client.expiresAt !== 'string' || !Number.isFinite(Date.parse(client.expiresAt)))) {
      return null;
    }
    if (client.revoked !== undefined && typeof client.revoked !== 'boolean') {
      return null;
    }
    clients.push({
      clientId: client.clientId,
      tokenSha256: client.tokenSha256,
      scopes: [...new Set(client.scopes as HarnessToolScope[])],
      ...(client.expiresAt !== undefined ? { expiresAt: client.expiresAt } : {}),
      ...(client.revoked !== undefined ? { revoked: client.revoked } : {}),
    });
  }

  return {
    enabled: obj.enabled,
    environment: obj.environment,
    ...(pilotInquiryIds !== undefined ? { pilotInquiryIds } : {}),
    clients,
  };
}

export function loadHarnessToolsConfig(): HarnessToolsConfig | null {
  const inlineRaw = process.env.LIBEREAL_HARNESS_TOOLS_CONFIG?.trim();
  if (inlineRaw) {
    try {
      return parseHarnessToolsConfig(JSON.parse(inlineRaw));
    } catch {
      return null;
    }
  }

  const filePath = process.env.LIBEREAL_HARNESS_TOOLS_CONFIG_PATH?.trim();
  if (!filePath || !isAbsolute(filePath)) {
    return null;
  }

  try {
    if (statSync(filePath).size > 65_536) return null;
    const rawText = readFileSync(filePath, 'utf8');
    return parseHarnessToolsConfig(JSON.parse(rawText));
  } catch {
    return null;
  }
}

export function harnessError(
  status: number,
  errorClass: HarnessErrorClass,
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      errorClass,
      code,
      message,
      retryable,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

export function harnessSuccess(
  tool: string,
  principal: HarnessPrincipal,
  inquiryVersion: string | null,
  data: unknown,
  status = 200,
): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      tool,
      environment: principal.environment,
      clientId: principal.clientId,
      readAt: new Date().toISOString(),
      inquiryVersion,
      data,
    },
    { status },
  );
}

export function findUntrustedAuthField(value: unknown, depth = 0): string | null {
  if (depth > 6 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findUntrustedAuthField(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (UNTRUSTED_AUTHORIZATION_FIELDS.has(key)) return key;
    const nested = findUntrustedAuthField(obj[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function rejectUntrustedAuthFields(body: unknown): NextResponse | null {
  const offendingField = findUntrustedAuthField(body);
  if (!offendingField) return null;
  return harnessError(
    400,
    'validation_error',
    'UNTRUSTED_AUTHORIZATION_FIELD',
    `请求体不允许包含越权或伪造授权字段: ${offendingField}`,
    false,
    { field: offendingField },
  );
}

export type HarnessAuthResult =
  | { ok: true; principal: HarnessPrincipal }
  | { ok: false; response: NextResponse };

export function authorizeHarnessRequest(
  req: { headers: { get(name: string): string | null } },
  options: { requiredScope: HarnessToolScope; inquiryId: string },
): HarnessAuthResult {
  const config = loadHarnessToolsConfig();
  if (!config || !config.enabled) {
    return {
      ok: false,
      response: harnessError(503, 'disabled', 'HARNESS_TOOLS_DISABLED', 'Harness 业务工具接口未启用'),
    };
  }

  const providedToken = req.headers.get(HARNESS_HEADER_TOKEN)?.trim() ?? '';
  const providedClientId = req.headers.get(HARNESS_HEADER_CLIENT_ID)?.trim() ?? '';
  const providedEnv = req.headers.get(HARNESS_HEADER_ENV)?.trim() ?? '';

  if (!providedToken || !providedClientId || !providedEnv) {
    return {
      ok: false,
      response: harnessError(401, 'unauthorized', 'MISSING_CREDENTIALS', '缺少 Harness 服务身份请求头'),
    };
  }

  if (providedEnv !== config.environment) {
    return {
      ok: false,
      response: harnessError(403, 'forbidden', 'ENVIRONMENT_MISMATCH', 'Harness 环境标识与当前服务不匹配'),
    };
  }

  const providedDigest = sha256Hex(providedToken);
  const client = config.clients.find((c) => c.clientId === providedClientId);
  if (!client) {
    // Perform a dummy constant-time compare to avoid client-existence timing differences.
    constantTimeHexMatch(providedDigest, '0'.repeat(64));
    return {
      ok: false,
      response: harnessError(401, 'unauthorized', 'INVALID_CREDENTIALS', 'Harness 客户端身份或凭据无效'),
    };
  }

  if (!constantTimeHexMatch(providedDigest, client.tokenSha256)) {
    return {
      ok: false,
      response: harnessError(401, 'unauthorized', 'INVALID_CREDENTIALS', 'Harness 客户端身份或凭据无效'),
    };
  }

  if (client.revoked === true) {
    return {
      ok: false,
      response: harnessError(403, 'forbidden', 'CLIENT_REVOKED', 'Harness 客户端凭据已吊销'),
    };
  }

  if (client.expiresAt !== undefined && Date.parse(client.expiresAt) <= Date.now()) {
    return {
      ok: false,
      response: harnessError(403, 'forbidden', 'CLIENT_EXPIRED', 'Harness 客户端凭据已过期'),
    };
  }

  if (!client.scopes.includes(options.requiredScope)) {
    return {
      ok: false,
      response: harnessError(403, 'forbidden', 'SCOPE_FORBIDDEN', `缺少所需工具权限: ${options.requiredScope}`),
    };
  }

  const inquiryId = options.inquiryId.trim();
  if (!inquiryId || inquiryId.length > 160) {
    return {
      ok: false,
      response: harnessError(400, 'validation_error', 'INVALID_INQUIRY_ID', '询价编号无效'),
    };
  }

  if (config.pilotInquiryIds !== undefined && !config.pilotInquiryIds.includes(inquiryId)) {
    return {
      ok: false,
      response: harnessError(403, 'forbidden', 'PILOT_SCOPE_FORBIDDEN', '该询价单不在当前试点允许范围内'),
    };
  }

  return {
    ok: true,
    principal: {
      clientId: client.clientId,
      environment: config.environment,
      scopes: client.scopes,
    },
  };
}
