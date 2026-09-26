import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { rateLimitAsync } from '@/lib/rateLimit';
import {
  ELISA_IMPORT_MAX_CELLS,
  ELISA_IMPORT_MAX_COLUMNS,
  ELISA_IMPORT_MAX_FILE_BYTES,
  ELISA_IMPORT_MAX_ROWS,
  ELISA_IMPORT_MAX_SHEETS,
  getElisaImportExtension,
  isAllowedElisaImportExtension,
  isAllowedElisaImportMimeType,
  parseElisaTableRows,
} from '@/data/elisa-import';
import { normalizeSpreadsheetCell, parseCsvRows } from '@/lib/csv-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const MAX_MULTIPART_OVERHEAD = 256 * 1024;
const XLSX_SIGNATURE = [0x50, 0x4b];

type UploadedFile = {
  name: string;
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

function requestIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function isTextFile(bytes: Uint8Array): boolean {
  const isUtf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!isUtf16 && bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
    return true;
  } catch {
    return false;
  }
}

function hasExpectedSignature(extension: string, bytes: Uint8Array): boolean {
  if (extension === 'xlsx') return startsWithBytes(bytes, XLSX_SIGNATURE);
  return isTextFile(bytes);
}

function isUploadedFile(value: unknown): value is UploadedFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UploadedFile>;
  return typeof candidate.name === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.type === 'string'
    && typeof candidate.arrayBuffer === 'function';
}

async function parseWorkbook(buffer: Buffer, extension: string) {
  if (extension === 'csv') return parseElisaTableRows(parseCsvRows(buffer.toString('utf8')));
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new Error('文件解析失败。');
  }

  if (workbook.worksheets.length === 0) throw new Error('文件中没有工作表。');
  if (workbook.worksheets.length > ELISA_IMPORT_MAX_SHEETS) throw new Error(`最多支持 ${ELISA_IMPORT_MAX_SHEETS} 个工作表。`);

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0 || sheet.columnCount === 0) throw new Error('文件中没有可读取的数据。');
  const rowCount = sheet.rowCount;
  const columnCount = sheet.columnCount;
  if (rowCount > ELISA_IMPORT_MAX_ROWS) throw new Error(`表格最多支持 ${ELISA_IMPORT_MAX_ROWS.toLocaleString('zh-CN')} 行。`);
  if (columnCount > ELISA_IMPORT_MAX_COLUMNS) throw new Error(`表格最多支持 ${ELISA_IMPORT_MAX_COLUMNS} 列。`);
  if (rowCount * columnCount > ELISA_IMPORT_MAX_CELLS) throw new Error('表格单元格数量超过限制。');

  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values;
    rows.push((Array.isArray(values) ? values.slice(1) : []).map(normalizeSpreadsheetCell));
  });
  return parseElisaTableRows(rows);
}

export async function POST(request: Request) {
  const limited = await rateLimitAsync(`elisa-import:${requestIp(request)}`);
  if (!limited.allowed) {
    return jsonError('表格读取请求过于频繁，请稍后重试。', 429);
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > ELISA_IMPORT_MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD) {
    return jsonError(`文件大小不能超过 ${(ELISA_IMPORT_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB。`, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('上传内容格式无效。', 400);
  }

  const file = formData.get('file');
  if (!isUploadedFile(file)) return jsonError('请选择需要读取的表格文件。', 400);

  const extension = getElisaImportExtension(file.name);
  if (!isAllowedElisaImportExtension(file.name)) return jsonError('仅支持 CSV 或 XLSX 文件。', 400);
  if (file.size === 0 || file.size > ELISA_IMPORT_MAX_FILE_BYTES) {
    return jsonError(`文件大小需在 1 字节至 ${(ELISA_IMPORT_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB 之间。`, 413);
  }
  if (!isAllowedElisaImportMimeType(file.type, extension)) return jsonError('文件类型不受支持。', 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedSignature(extension, bytes)) return jsonError('文件扩展名与文件内容不匹配。', 400);

  try {
    const rows = await parseWorkbook(Buffer.from(bytes), extension);
    return NextResponse.json(
      { rows },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  } catch (error) {
    console.error('[ELISA import] rejected file:', error instanceof Error ? error.message : 'unknown parse error');
    return jsonError(error instanceof Error ? error.message : '表格读取失败，请检查文件后重试。', 400);
  }
}
