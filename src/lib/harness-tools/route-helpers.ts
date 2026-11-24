import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeHarnessRequest,
  harnessError,
  harnessSuccess,
  rejectUntrustedAuthFields,
  type HarnessPrincipal,
  type HarnessToolScope,
} from './auth';
import { mapHarnessServiceError } from './inquiry-tools-service';

type ParamsArg = { params: Promise<{ id: string }> };

export async function handleHarnessInquiryGet<T>(
  req: NextRequest,
  { params }: ParamsArg,
  options: {
    tool: string;
    requiredScope: HarnessToolScope;
    run: (inquiryId: string, principal: HarnessPrincipal) => Promise<{
      inquiryVersion: string | null;
      data: T;
    }>;
  },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = authorizeHarnessRequest(req, {
    requiredScope: options.requiredScope,
    inquiryId: id,
  });
  if (!auth.ok) return auth.response;

  try {
    const result = await options.run(id.trim(), auth.principal);
    return harnessSuccess(options.tool, auth.principal, result.inquiryVersion, result.data);
  } catch (err) {
    const mapped = mapHarnessServiceError(err);
    if (mapped.status >= 500) {
      console.error(`[harness ${options.tool}] error:`, err);
    }
    return harnessError(
      mapped.status,
      mapped.errorClass,
      mapped.code,
      mapped.message,
      mapped.retryable,
      mapped.details,
    );
  }
}

export async function handleHarnessInquiryPost<T>(
  req: NextRequest,
  { params }: ParamsArg,
  options: {
    tool: string;
    requiredScope: HarnessToolScope;
    allowEmptyBody?: boolean;
    run: (
      inquiryId: string,
      body: Record<string, unknown>,
      principal: HarnessPrincipal,
    ) => Promise<{
      status?: number;
      inquiryVersion: string | null;
      data: T;
    }>;
  },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = authorizeHarnessRequest(req, {
    requiredScope: options.requiredScope,
    inquiryId: id,
  });
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  const rawText = await req.text();
  if (rawText.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return harnessError(400, 'validation_error', 'INVALID_BODY', '请求体不是有效 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return harnessError(400, 'validation_error', 'INVALID_BODY', '请求体必须为 JSON 对象');
    }
    const untrusted = rejectUntrustedAuthFields(parsed);
    if (untrusted) return untrusted;
    body = parsed as Record<string, unknown>;
  } else if (!options.allowEmptyBody) {
    return harnessError(400, 'validation_error', 'INVALID_BODY', '请求体不能为空');
  }

  try {
    const result = await options.run(id.trim(), body, auth.principal);
    return harnessSuccess(
      options.tool,
      auth.principal,
      result.inquiryVersion,
      result.data,
      result.status ?? 200,
    );
  } catch (err) {
    const mapped = mapHarnessServiceError(err);
    if (mapped.status >= 500) {
      console.error(`[harness ${options.tool}] error:`, err);
    }
    return harnessError(
      mapped.status,
      mapped.errorClass,
      mapped.code,
      mapped.message,
      mapped.retryable,
      mapped.details,
    );
  }
}
