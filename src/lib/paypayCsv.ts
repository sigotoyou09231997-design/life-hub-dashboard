import type { TransactionType } from "../types";
import { parseCsvRows, parseAmount } from "./csv";
export { parseCsvLine } from "./csv";

export interface ParsedPayPayRow {
  /** Composite dedup key: PayPay's own 取引番号 isn't unique per row — a
   * single purchase can spawn a sibling "point cashback" row with the same
   * number, so the transaction number alone can't identify a row. */
  externalId: string;
  date: string; // YYYY-MM-DD
  /** Signed net effect on the PayPay balance for this row (deposit - withdrawal). */
  amount: number;
  withdrawal: number;
  deposit: number;
  content: string;
  counterparty: string;
}

export interface ClassifiedHouseholdEntry {
  type: TransactionType;
  amount: number;
  category: string;
  store?: string;
  memo?: string;
}

/**
 * Parses a PayPay "取引履歴" export. Expected columns (PayPay's standard
 * format, no balance column included):
 * 取引日, 出金金額(円), 入金金額(円), 海外出金金額, 通貨, 換算レート(円),
 * 利用国, 取引内容, 取引先, 取引方法, 支払い区分, 利用者, 取引番号
 */
export function parsePayPayCsv(text: string): ParsedPayPayRow[] {
  const lines = parseCsvRows(text);
  if (lines.length < 2) return [];

  const rows: ParsedPayPayRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i];
    if (cells.length < 13) continue;

    const dateTimeRaw = cells[0].replace(/^﻿/, "").trim();
    const datePart = dateTimeRaw.split(" ")[0]?.replace(/\//g, "-");
    if (!datePart) continue;

    const withdrawal = parseAmount(cells[1]);
    const deposit = parseAmount(cells[2]);
    const content = cells[7]?.trim() ?? "";
    const counterparty = cells[8]?.trim() ?? "";
    const transactionNumber = cells[12]?.trim() ?? `${dateTimeRaw}-${i}`;

    rows.push({
      externalId: `${transactionNumber}|${content}|${withdrawal}|${deposit}`,
      date: datePart,
      amount: deposit - withdrawal,
      withdrawal,
      deposit,
      content,
      counterparty,
    });
  }
  return rows;
}

/**
 * Decides whether a row represents real household spending/income (worth
 * recording in the budget ledger) or a wallet-internal movement — a charge
 * from the bank, a cash-out back to the bank, or a tiny point-to-balance
 * conversion. Internal movements still affect the PayPay balance but aren't
 * "spending", so they're excluded here (still tracked in the raw ledger).
 */
export function classifyForHousehold(row: ParsedPayPayRow): ClassifiedHouseholdEntry | null {
  switch (row.content) {
    case "支払い":
      return {
        type: "expense",
        amount: row.withdrawal,
        category: "その他",
        store: row.counterparty,
        memo: "PayPay支払い",
      };
    case "送った金額":
      return {
        type: "expense",
        amount: row.withdrawal,
        category: "その他",
        store: row.counterparty,
        memo: "PayPay送金",
      };
    case "受け取った金額":
      return {
        type: "income",
        amount: row.deposit,
        category: "臨時収入",
        store: row.counterparty,
        memo: "PayPay受取",
      };
    default:
      // チャージ, 口座出金, ポイントで残高の獲得 など、財布の中身が動くだけの取引
      return null;
  }
}

/** Reads a PayPay CSV export, which is normally Shift-JIS encoded. Falls
 * back to UTF-8 if the Shift-JIS decode doesn't look like the expected format. */
export async function decodePayPayCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const shiftJisText = new TextDecoder("shift_jis").decode(buffer);
  if (shiftJisText.includes("取引")) return shiftJisText;
  return new TextDecoder("utf-8").decode(buffer);
}
