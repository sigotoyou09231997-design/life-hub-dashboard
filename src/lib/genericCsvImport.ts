import type { Transaction, TransactionType } from "../types";
import { parseAmount } from "./csv";

export type AmountMode =
  | { kind: "signed"; column: number; positiveType: TransactionType }
  | { kind: "split"; outflowColumn: number; inflowColumn: number };

export interface ColumnMapping {
  hasHeaderRow: boolean;
  dateColumn: number;
  amount: AmountMode;
  /** -> memo. Also strengthens the dedup key. */
  descriptionColumn?: number;
  /** -> store */
  storeColumn?: number;
  defaultExpenseCategory: string;
  defaultIncomeCategory: string;
  /** Applied to expense rows only, matching ExpenseForm's convention. */
  defaultMethod?: string;
}

export interface MappedRow {
  transaction: Omit<Transaction, "id" | "createdAt">;
  externalId: string;
}

export interface MappingResult {
  rows: MappedRow[];
  skippedUnparseable: number;
}

const FLEXIBLE_DATE_RE = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/;

/** Accepts unambiguous YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD (a trailing time,
 * space-separated, is dropped). Ambiguous formats like MM/DD/YYYY are
 * intentionally not guessed — returns null so the caller can count it as
 * unparseable rather than silently importing a wrong date. */
function parseFlexibleDate(cell: string | undefined): string | null {
  if (!cell) return null;
  const firstToken = cell.replace(/^﻿/, "").trim().split(" ")[0];
  const m = FLEXIBLE_DATE_RE.exec(firstToken);
  if (!m) return null;
  const [, year, month, day] = m;
  const mm = month.padStart(2, "0");
  const dd = day.padStart(2, "0");
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${year}-${mm}-${dd}`;
}

function opposite(type: TransactionType): TransactionType {
  return type === "expense" ? "income" : "expense";
}

/** Maps raw tokenized CSV rows into Transaction-shaped records per a
 * user-chosen column mapping, computing a deterministic dedup key for each
 * row so re-importing the same file doesn't duplicate. */
export function mapCsvRowsToTransactions(rows: string[][], mapping: ColumnMapping): MappingResult {
  const dataRows = mapping.hasHeaderRow ? rows.slice(1) : rows;
  const occurrenceCounts = new Map<string, number>();
  const mapped: MappedRow[] = [];
  let skippedUnparseable = 0;

  for (const cells of dataRows) {
    const date = parseFlexibleDate(cells[mapping.dateColumn]);
    if (!date) {
      skippedUnparseable++;
      continue;
    }

    let type: TransactionType;
    let amount: number;
    if (mapping.amount.kind === "signed") {
      const raw = parseAmount(cells[mapping.amount.column]);
      if (raw === 0) {
        skippedUnparseable++;
        continue;
      }
      type = raw >= 0 ? mapping.amount.positiveType : opposite(mapping.amount.positiveType);
      amount = Math.abs(raw);
    } else {
      const outflow = parseAmount(cells[mapping.amount.outflowColumn]);
      const inflow = parseAmount(cells[mapping.amount.inflowColumn]);
      if (outflow !== 0) {
        type = "expense";
        amount = Math.abs(outflow);
      } else if (inflow !== 0) {
        type = "income";
        amount = Math.abs(inflow);
      } else {
        skippedUnparseable++;
        continue;
      }
    }

    const memo = mapping.descriptionColumn != null ? cells[mapping.descriptionColumn]?.trim() || undefined : undefined;
    const store = mapping.storeColumn != null ? cells[mapping.storeColumn]?.trim() || undefined : undefined;
    const category = type === "expense" ? mapping.defaultExpenseCategory : mapping.defaultIncomeCategory;
    const method = type === "expense" ? mapping.defaultMethod : undefined;

    // Deterministic dedup key: same file, same row order -> same keys, so a
    // re-import is correctly caught as duplicates. Known limitation: a source
    // that prepends new rows instead of appending can shift this alignment.
    const dedupBase = `csv:${date}:${type}:${amount}:${memo ?? ""}`;
    const occurrence = occurrenceCounts.get(dedupBase) ?? 0;
    occurrenceCounts.set(dedupBase, occurrence + 1);
    const externalId = `${dedupBase}:${occurrence}`;

    mapped.push({
      transaction: {
        type,
        amount,
        category,
        method,
        store,
        memo,
        date,
        isFixed: false,
        externalId,
      },
      externalId,
    });
  }

  return { rows: mapped, skippedUnparseable };
}
