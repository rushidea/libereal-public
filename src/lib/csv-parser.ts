/** Parse comma-separated text with quoted fields and escaped quotes. */
export function parseCsvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV 引号未闭合。');
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function normalizeSpreadsheetCell(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value ?? '';
  const cell = value as { result?: unknown; text?: unknown; richText?: Array<{ text?: string }> };
  if ('result' in cell) return cell.result ?? '';
  if (typeof cell.text === 'string') return cell.text;
  if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text ?? '').join('');
  return '';
}
