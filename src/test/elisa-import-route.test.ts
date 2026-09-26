import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('@/lib/rateLimit', () => ({
  rateLimitAsync: vi.fn(),
}));

import { rateLimitAsync } from '@/lib/rateLimit';
import { POST } from '@/app/api/calculators/elisa-import/route';
import {
  ELISA_IMPORT_MAX_CELLS,
  ELISA_IMPORT_MAX_COLUMNS,
  ELISA_IMPORT_MAX_FILE_BYTES,
  ELISA_IMPORT_MAX_ROWS,
  parseElisaTableRows,
} from '@/data/elisa-import';

const rateLimitMock = rateLimitAsync as unknown as ReturnType<typeof vi.fn>;

function requestFor(file: File, headers?: HeadersInit): Request {
  const formData = new FormData();
  formData.append('file', file);
  return {
    headers: new Headers(headers),
    formData: async () => formData,
  } as unknown as Request;
}

async function workbookFile(sheets: Array<{ name: string; rows: unknown[][] }>, name = 'elisa.xlsx'): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row) => worksheet.addRow(row));
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('ELISA import route', () => {
  beforeEach(() => {
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 2, resetIn: 300_000 });
  });

  it('parses one bounded worksheet and returns normalized rows', async () => {
    const response = await POST(requestFor(await workbookFile([{
      name: '数据',
      rows: [
        ['类型', '浓度', 'OD1', 'OD2'],
        ['标准', 1, 0.1, 0.2],
        ['样本', '', 0.5, 0.6],
      ],
    }])));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rows: {
        standards: [{ concentration: '1', odValues: '0.1, 0.2' }],
        samples: [{ name: '样本', odValues: '0.5, 0.6', dilution: '1' }],
      },
    });
  });

  it('parses CSV rows with quoted fields', async () => {
    const file = new File([
      'Type,Sample,Concentration,OD1,OD2\r\nstandard,,1,0.1,0.2\r\nsample,"Sample, A",,0.5,0.6\r\n',
    ], 'elisa.csv', { type: 'text/csv' });
    const response = await POST(requestFor(file));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rows: {
        standards: [{ concentration: '1', odValues: '0.1, 0.2' }],
        samples: [{ name: 'Sample, A', odValues: '0.5, 0.6', dilution: '1' }],
      },
    });
  });

  it('rejects a file whose extension and signature do not match', async () => {
    const file = new File([new TextEncoder().encode('not an xlsx file')], 'elisa.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const response = await POST(requestFor(file));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: '文件扩展名与文件内容不匹配。' });
  });

  it('rejects a known MIME type that does not match the extension', async () => {
    const file = await workbookFile([{ name: '数据', rows: [['浓度', 'OD1'], [1, 0.1]] }]);
    const mismatchedFile = new File([await file.arrayBuffer()], 'elisa.xlsx', { type: 'text/csv' });
    const response = await POST(requestFor(mismatchedFile));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: '文件类型不受支持。' });
  });

  it('rejects files above the upload limit before parsing', async () => {
    const file = new File([new Uint8Array(ELISA_IMPORT_MAX_FILE_BYTES + 1)], 'elisa.csv', {
      type: 'text/csv',
    });
    const response = await POST(requestFor(file));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('10 MB') });
  });

  it('rejects workbooks with more than one worksheet', async () => {
    const response = await POST(requestFor(await workbookFile([
      { name: '一', rows: [['浓度', 'OD1'], [1, 0.1]] },
      { name: '二', rows: [['浓度', 'OD1'], [2, 0.2]] },
    ])));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: '最多支持 1 个工作表。' });
  });

  it('rejects rows, columns, and cells above the shared limits', () => {
    expect(() => parseElisaTableRows(Array.from({ length: ELISA_IMPORT_MAX_ROWS + 1 }, () => [])))
      .toThrow(`表格最多支持 ${ELISA_IMPORT_MAX_ROWS.toLocaleString('zh-CN')} 行。`);
    expect(() => parseElisaTableRows([Array.from({ length: ELISA_IMPORT_MAX_COLUMNS + 1 }, () => '')]))
      .toThrow(`表格最多支持 ${ELISA_IMPORT_MAX_COLUMNS} 列。`);
    expect(() => parseElisaTableRows(Array.from(
      { length: Math.floor(ELISA_IMPORT_MAX_CELLS / ELISA_IMPORT_MAX_COLUMNS) + 1 },
      () => Array.from({ length: ELISA_IMPORT_MAX_COLUMNS }, () => ''),
    )))
      .toThrow('表格单元格数量超过限制。');
    expect(ELISA_IMPORT_MAX_CELLS).toBe(100_000);
  });

  it('rate limits repeated public parsing requests', async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0, resetIn: 1_000 });
    const response = await POST(requestFor(new File(['data'], 'elisa.csv', { type: 'text/csv' })));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: '表格读取请求过于频繁，请稍后重试。' });
  });
});
