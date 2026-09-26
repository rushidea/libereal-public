export type ElisaImportedStandard = {
  concentration: string;
  odValues: string;
};

export type ElisaImportedSample = {
  name: string;
  odValues: string;
  dilution: string;
};

export type ElisaImportedRows = {
  standards: ElisaImportedStandard[];
  samples: ElisaImportedSample[];
};

export const ELISA_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ELISA_IMPORT_MAX_ROWS = 5_000;
export const ELISA_IMPORT_MAX_COLUMNS = 32;
export const ELISA_IMPORT_MAX_CELLS = 100_000;
export const ELISA_IMPORT_MAX_SHEETS = 1;
export const ELISA_IMPORT_ALLOWED_EXTENSIONS = ['csv', 'xlsx'] as const;
export const ELISA_IMPORT_ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/csv',
  'text/csv',
  'text/plain',
  'application/octet-stream',
]);

export function getElisaImportExtension(fileName: string): string {
  const match = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

export function isAllowedElisaImportExtension(fileName: string): boolean {
  return ELISA_IMPORT_ALLOWED_EXTENSIONS.includes(
    getElisaImportExtension(fileName) as typeof ELISA_IMPORT_ALLOWED_EXTENSIONS[number],
  );
}

export function isAllowedElisaImportMimeType(mimeType: string, extension?: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized || normalized === 'application/octet-stream') return true;
  if (!ELISA_IMPORT_ALLOWED_MIME_TYPES.has(normalized)) return false;
  if (extension === 'xlsx') return normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (extension === 'csv') return normalized === 'application/csv' || normalized === 'text/csv' || normalized === 'text/plain';
  return false;
}

export function isElisaImportedRows(value: unknown): value is ElisaImportedRows {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { standards?: unknown; samples?: unknown };
  if (!Array.isArray(candidate.standards) || !Array.isArray(candidate.samples)) return false;
  return candidate.standards.every((row) => (
    row && typeof row === 'object'
    && typeof (row as { concentration?: unknown }).concentration === 'string'
    && typeof (row as { odValues?: unknown }).odValues === 'string'
  )) && candidate.samples.every((row) => (
    row && typeof row === 'object'
    && typeof (row as { name?: unknown }).name === 'string'
    && typeof (row as { odValues?: unknown }).odValues === 'string'
    && typeof (row as { dilution?: unknown }).dilution === 'string'
  ));
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function cellText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function parseNumber(value: unknown): number | null {
  const cleaned = cellText(value).replace(/,/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseElisaTableRows(rows: unknown[][]): ElisaImportedRows {
  if (!Array.isArray(rows)) throw new Error('表格数据格式无效。');
  if (rows.length > ELISA_IMPORT_MAX_ROWS) throw new Error(`表格最多支持 ${ELISA_IMPORT_MAX_ROWS.toLocaleString('zh-CN')} 行。`);

  let cellCount = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) throw new Error('表格数据格式无效。');
    if (row.length > ELISA_IMPORT_MAX_COLUMNS) throw new Error(`表格最多支持 ${ELISA_IMPORT_MAX_COLUMNS} 列。`);
    cellCount += row.length;
    if (cellCount > ELISA_IMPORT_MAX_CELLS) throw new Error('表格单元格数量超过限制。');
  }

  if (rows.length === 0) return { standards: [], samples: [] };
  const headers = rows[0].map(normalizeHeader);
  const hasHeader = headers.some((header) => /type|类型|sample|样本|standard|标准|浓度|concentration|od|450/.test(header));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const headerIndex = (patterns: RegExp[]) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  const typeIndex = hasHeader ? headerIndex([/type/, /类型/]) : -1;
  const nameIndex = hasHeader ? headerIndex([/sample/, /样本/, /name/, /名称/]) : -1;
  const concentrationIndex = hasHeader ? headerIndex([/concentration/, /conc/, /浓度/, /standard/]) : 0;
  const dilutionIndex = hasHeader ? headerIndex([/dilution/, /稀释/]) : -1;
  const odIndexes = hasHeader
    ? headers.map((header, index) => (/od|450|abs/.test(header) ? index : -1)).filter((index) => index >= 0)
    : [];
  const standards: ElisaImportedStandard[] = [];
  const samples: ElisaImportedSample[] = [];

  dataRows.forEach((row, index) => {
    const cells = row.map(cellText);
    if (!cells.some(Boolean)) return;
    const typeCell = typeIndex >= 0 ? normalizeHeader(cells[typeIndex]) : '';
    const nameCell = nameIndex >= 0 ? cells[nameIndex] : cells[0];
    const concentrationCell = concentrationIndex >= 0 ? cells[concentrationIndex] : '';
    const odCells = odIndexes.length > 0
      ? odIndexes.map((cellIndex) => cells[cellIndex]).filter(Boolean)
      : cells.slice(hasHeader ? 1 : 1).filter((_, cellIndex) => (hasHeader ? cellIndex + 1 !== dilutionIndex : true));
    const odValues = odCells.join(', ');
    const concentration = parseNumber(concentrationCell);
    const looksStandard = typeCell.includes('std') || typeCell.includes('standard') || typeCell.includes('标准');
    const looksSample = typeCell.includes('sample') || typeCell.includes('样本');

    if (looksStandard || (!looksSample && concentration !== null)) {
      standards.push({ concentration: concentrationCell, odValues });
      return;
    }

    samples.push({
      name: nameCell || `样本 ${index + 1}`,
      odValues,
      dilution: dilutionIndex >= 0 ? (cells[dilutionIndex] || '1') : '1',
    });
  });

  return { standards, samples };
}
