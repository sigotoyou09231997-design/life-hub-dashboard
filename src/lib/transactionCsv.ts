import type { Transaction } from "../types";

/** 書き出す列。取り込み側(genericCsvImport)が読める並びではなく、家計簿として
 * 見返す・確定申告に回すことを想定した並びにしている。 */
export const TRANSACTION_CSV_HEADER = [
  "日付",
  "種別",
  "カテゴリ",
  "金額",
  "支払い方法",
  "店名",
  "メモ",
  "固定費",
] as const;

/** Excelが文字コードを取り違えないための印。これが無いとUTF-8として開かれず、
 * 日本語の列が化ける(バックアップのJSONと違い、表計算ソフトで開く前提のため付ける)。 */
const UTF8_BOM = "﻿";

/** カンマ・改行・二重引用符を含むセルだけを引用符で囲む(RFC 4180)。 */
export function csvCell(value: string | undefined): string {
  const text = value ?? "";
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** 書き出す対象を期間で絞り、日付の古い順に並べる。start/endはその日を含む。
 * 空文字を渡した端は「制限なし」として扱う。 */
export function filterTransactionsForExport(
  transactions: Transaction[],
  start: string,
  end: string,
): Transaction[] {
  return transactions
    .filter((t) => (!start || t.date >= start) && (!end || t.date <= end))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

/** 収支をCSV本文にする。改行はExcelがそのまま開けるCRLF。 */
export function buildTransactionCsv(transactions: Transaction[]): string {
  const rows = [
    TRANSACTION_CSV_HEADER.join(","),
    ...transactions.map((t) =>
      [
        csvCell(t.date),
        csvCell(t.type === "income" ? "収入" : "支出"),
        csvCell(t.category),
        String(Math.round(t.amount)),
        csvCell(t.method),
        csvCell(t.store),
        csvCell(t.memo),
        csvCell(t.isFixed ? "はい" : "いいえ"),
      ].join(","),
    ),
  ];
  return rows.join("\r\n");
}

export function transactionCsvFilename(start: string, end: string): string {
  const range = start && end ? `${start}_${end}` : start || end || "all";
  return `life-hub-transactions-${range}.csv`;
}

/** ファイルとして落とす(バックアップの書き出しと同じやり方)。 */
export function downloadTransactionCsv(csv: string, filename: string): void {
  const blob = new Blob([UTF8_BOM, csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
