import type { SalaryDeductionItem, SalaryEntry } from "../types";
import { parseAmount } from "./csv";

/** A payslip CSV row typically carries either a full payment date
 * (支給日: 2026/8/25) or just a target month (対象年月: 2026年8月). Both are
 * accepted; only the former also yields a payday. */
export interface ParsedMonthOrDate {
  month: string; // YYYY-MM
  payday: number | null;
}

const FULL_DATE_RE = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})/;
const MONTH_ONLY_RE = /^(\d{4})[/\-.年](\d{1,2})月?$/;

export function parseFlexibleMonthOrDate(cell: string | undefined): ParsedMonthOrDate | null {
  if (!cell) return null;
  const trimmed = cell.replace(/^﻿/, "").trim().split(" ")[0];

  const full = FULL_DATE_RE.exec(trimmed);
  if (full) {
    const [, year, month, day] = full;
    const mm = Number(month);
    const dd = Number(day);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return { month: `${year}-${month.padStart(2, "0")}`, payday: dd };
  }

  const monthOnly = MONTH_ONLY_RE.exec(trimmed);
  if (monthOnly) {
    const [, year, month] = monthOnly;
    const mm = Number(month);
    if (mm < 1 || mm > 12) return null;
    return { month: `${year}-${month.padStart(2, "0")}`, payday: null };
  }

  return null;
}

export interface SalaryColumnMapping {
  hasHeaderRow: boolean;
  /** Column holding either a full payment date or a target month. */
  dateColumn: number;
  /** Used as the payday when dateColumn only yields a month (no day). */
  fallbackPayday: number;
  /** -> amount (take-home pay). */
  netAmountColumn: number;
  /** -> grossAmount, optional. */
  grossAmountColumn?: number;
  /** Each -> one SalaryDeductionItem, labeled with that column's header. */
  deductionColumns: number[];
}

export interface MappedSalaryRow {
  entry: Omit<SalaryEntry, "id" | "createdAt">;
}

export interface SalaryMappingResult {
  rows: MappedSalaryRow[];
  skippedUnparseable: number;
}

/** Maps raw tokenized CSV rows into SalaryEntry-shaped records per a
 * user-chosen column mapping. One row = one month's payslip. */
export function mapCsvRowsToSalaries(
  rows: string[][],
  header: string[] | null,
  mapping: SalaryColumnMapping,
): SalaryMappingResult {
  const dataRows = mapping.hasHeaderRow ? rows.slice(1) : rows;
  const mapped: MappedSalaryRow[] = [];
  let skippedUnparseable = 0;

  for (const cells of dataRows) {
    const parsedDate = parseFlexibleMonthOrDate(cells[mapping.dateColumn]);
    const amount = parseAmount(cells[mapping.netAmountColumn]);
    if (!parsedDate || amount <= 0) {
      skippedUnparseable++;
      continue;
    }

    const grossAmount =
      mapping.grossAmountColumn != null ? parseAmount(cells[mapping.grossAmountColumn]) || undefined : undefined;

    const deductions: SalaryDeductionItem[] = mapping.deductionColumns
      .map((col) => ({ label: header?.[col]?.trim() || `列${col + 1}`, amount: parseAmount(cells[col]) }))
      .filter((d) => d.amount > 0);

    mapped.push({
      entry: {
        month: parsedDate.month,
        payday: parsedDate.payday ?? mapping.fallbackPayday,
        amount,
        grossAmount,
        deductions: deductions.length > 0 ? deductions : undefined,
      },
    });
  }

  return { rows: mapped, skippedUnparseable };
}

export interface DeductionAggregate {
  label: string;
  total: number;
  /** Number of months this label appeared in. */
  count: number;
}

/** Aggregates itemized deductions across all salary entries, sorted by total
 * amount descending — answers "what's most often/heavily deducted". */
export function aggregateDeductions(salaries: SalaryEntry[]): DeductionAggregate[] {
  const byLabel = new Map<string, DeductionAggregate>();
  for (const salary of salaries) {
    for (const item of salary.deductions ?? []) {
      const existing = byLabel.get(item.label);
      if (existing) {
        existing.total += item.amount;
        existing.count += 1;
      } else {
        byLabel.set(item.label, { label: item.label, total: item.amount, count: 1 });
      }
    }
  }
  return [...byLabel.values()].sort((a, b) => b.total - a.total);
}
