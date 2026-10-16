/**
 * CSV writing and parsing (RFC 4180) for exports (DS-04#AC7, RP-04, DM-04#AC3) and imports
 * (PPL-04).
 *
 * - `toCsv` quotes fields that need it, uses CRLF (Excel-friendly) and neutralises spreadsheet
 *   formula injection: a text cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`.
 *   Numbers are written as numbers.
 * - `parseCsv` handles quoted fields, escaped quotes, embedded newlines, CRLF/LF and a UTF-8 BOM.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */

export type CsvCell = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvCell;
}

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells → CSV text (header row first when given). */
export function toCsvRows(rows: CsvCell[][], header?: string[]): string {
  const lines = (header ? [header, ...rows] : rows).map((r) => r.map(escapeCsvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Objects + column definitions → CSV text. */
export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string {
  return toCsvRows(
    rows.map((r) => columns.map((c) => c.value(r))),
    columns.map((c) => c.header),
  );
}

/** "{page}-{yyyy-mm-dd}.csv" (DS-04#AC7). */
export function csvFileName(page: string, isoDate: string): string {
  const base = page
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'export'}-${isoDate.slice(0, 10)}.csv`;
}

/** Parses CSV text into rows of strings. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      endField();
      i++;
    } else if (ch === '\r') {
      endRow();
      i += src[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Parses CSV with a header row into records keyed by the normalised header (lower case, `_` for spaces). */
export function parseCsvRecords(text: string): { headers: string[]; records: Array<Record<string, string>> } {
  const [head, ...body] = parseCsv(text);
  const headers = (head ?? []).map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_'),
  );
  const records = body.map((cells) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => {
      r[h] = (cells[i] ?? '').trim();
    });
    return r;
  });
  return { headers, records };
}
