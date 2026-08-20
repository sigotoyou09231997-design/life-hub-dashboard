/** Parses a single CSV line, respecting double-quoted fields (which may
 * contain commas, e.g. `"1,197"`) and doubled-quote escaping. */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/** Splits CSV text into non-empty lines and tokenizes each with `parseCsvLine`. */
export function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0)
    .map(parseCsvLine);
}

/** Parses a numeric cell, stripping thousands-separator commas. `"-"` and
 * empty cells (common placeholders for "no value" in Japanese exports) are 0. */
export function parseAmount(cell: string | undefined): number {
  if (!cell) return 0;
  const trimmed = cell.trim();
  if (trimmed === "-" || trimmed === "") return 0;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface CsvPreview {
  header: string[] | null;
  sampleRows: string[][];
  totalDataRows: number;
  columnCount: number;
}

/** Splits raw tokenized CSV rows into header (if any) + data rows, and caps
 * the sample shown in a mapping-preview table. */
export function buildPreview(rows: string[][], hasHeaderRow: boolean, sampleSize = 5): CsvPreview {
  const header = hasHeaderRow ? (rows[0] ?? null) : null;
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;
  const columnCount = dataRows.reduce((max, r) => Math.max(max, r.length), header?.length ?? 0);
  return {
    header,
    sampleRows: dataRows.slice(0, sampleSize),
    totalDataRows: dataRows.length,
    columnCount,
  };
}

export type CsvEncoding = "utf-8" | "shift_jis";

/** Decodes an arbitrary CSV file, auto-detecting encoding: a UTF-8 BOM is
 * treated as certain; otherwise a strict (fatal) UTF-8 decode is tried first
 * since Shift-JIS byte sequences very often aren't valid UTF-8, falling back
 * to Shift-JIS on failure. */
export async function decodeCsvFileAuto(file: File): Promise<{ text: string; encoding: CsvEncoding }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("shift_jis").decode(buffer), encoding: "shift_jis" };
  }
}

/** Decodes a CSV file with an explicit, user-chosen encoding (recovery path
 * when auto-detection guesses wrong). */
export async function decodeCsvFileAs(file: File, encoding: CsvEncoding): Promise<string> {
  const buffer = await file.arrayBuffer();
  return new TextDecoder(encoding).decode(buffer);
}
