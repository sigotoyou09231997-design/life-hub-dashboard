import type { TransactionType } from "../types";
import { decodeCsvFileAuto, parseCsvRows, parseAmount } from "./csv";
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

/** 列の位置。PayPay の標準の並び(下の parsePayPayCsv の説明)を既定にし、見出しの名前が読めればそちらに合わせる。 */
interface PayPayColumns {
  date: number;
  withdrawal: number;
  deposit: number;
  content: number;
  counterparty: number;
  transactionNumber: number;
}

const DEFAULT_COLUMNS: PayPayColumns = { date: 0, withdrawal: 1, deposit: 2, content: 7, counterparty: 8, transactionNumber: 12 };

/** 見出しの名前から列を探す。かっこが全角(本物の書き出し)でも半角でも、列の並びが変わっても読めるように。 */
function columnsFromHeader(header: string[]): PayPayColumns {
  const names = header.map((h) => h.replace(/^\uFEFF/, "").trim());
  const find = (test: (name: string) => boolean, fallback: number) => {
    const index = names.findIndex(test);
    return index >= 0 ? index : fallback;
  };
  return {
    date: find((n) => n.startsWith("取引日"), DEFAULT_COLUMNS.date),
    // 「海外出金金額」も「出金金額」を含むので、先頭で見分ける。
    withdrawal: find((n) => n.startsWith("出金金額"), DEFAULT_COLUMNS.withdrawal),
    deposit: find((n) => n.startsWith("入金金額"), DEFAULT_COLUMNS.deposit),
    content: find((n) => n === "取引内容", DEFAULT_COLUMNS.content),
    counterparty: find((n) => n === "取引先", DEFAULT_COLUMNS.counterparty),
    transactionNumber: find((n) => n === "取引番号", DEFAULT_COLUMNS.transactionNumber),
  };
}

/**
 * PayPay の取引履歴の CSV か(見出しの行で見分ける)。「CSVから取込」(銀行・カードの明細)に
 * PayPay のファイルを入れた時も、PayPay の読み方で取り込むために使う。
 */
export function isPayPayCsv(text: string): boolean {
  const header = parseCsvRows(text.slice(0, 2000))[0];
  if (!header) return false;
  const names = header.map((h) => h.replace(/^\uFEFF/, "").trim());
  return names.some((n) => n.startsWith("取引日")) && names.includes("取引内容") && names.includes("取引番号");
}

/**
 * Parses a PayPay "取引履歴" export. Expected columns (PayPay's standard
 * format, no balance column included):
 * 取引日, 出金金額（円）, 入金金額（円）, 海外出金金額, 通貨, 変換レート（円）,
 * 利用国, 取引内容, 取引先, 取引方法, 支払い区分, 利用者, 取引番号
 * 列は見出しの名前で探す(見つからない列だけ、上の並びの位置を使う)。
 */
export function parsePayPayCsv(text: string): ParsedPayPayRow[] {
  const lines = parseCsvRows(text);
  if (lines.length < 2) return [];
  const col = columnsFromHeader(lines[0]);
  const needed = Math.max(col.date, col.withdrawal, col.deposit, col.content, col.counterparty) + 1;

  const rows: ParsedPayPayRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i];
    if (cells.length < needed) continue;

    const dateTimeRaw = cells[col.date].replace(/^\uFEFF/, "").trim();
    const datePart = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(dateTimeRaw.split(" ")[0] ?? "");
    if (!datePart) continue;
    const date = `${datePart[1]}-${datePart[2].padStart(2, "0")}-${datePart[3].padStart(2, "0")}`;

    const withdrawal = parseAmount(cells[col.withdrawal]);
    const deposit = parseAmount(cells[col.deposit]);
    const content = cells[col.content]?.trim() ?? "";
    const counterparty = cells[col.counterparty]?.trim() ?? "";
    const transactionNumber = cells[col.transactionNumber]?.trim() || `${dateTimeRaw}-${i}`;

    rows.push({
      externalId: `${transactionNumber}|${content}|${withdrawal}|${deposit}`,
      date,
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

/**
 * PayPay の CSV を文字にする。いまのアプリの書き出しは UTF-8(先頭に BOM)、古いものは Shift-JIS。
 * 先に UTF-8 として読めるか確かめ、読めない時だけ Shift-JIS で読む(src/lib/csv.ts の decodeCsvFileAuto)。
 * 以前は先に Shift-JIS で読んでいたため、Shift-JIS を読めない端末では UTF-8 のファイルまで読み込みに失敗した。
 */
export async function decodePayPayCsvFile(file: File): Promise<string> {
  return (await decodeCsvFileAuto(file)).text;
}

// ---------------------------------------------------------------------------
// 取り込みの計画(何を足し、何を重複として飛ばすか)。データベースに触らない計算だけなので、ここで単体テストする。

export interface PayPayHouseholdDraft {
  row: ParsedPayPayRow;
  entry: ClassifiedHouseholdEntry;
}

/** 突き合わせに使う、お金管理に入っている記録の形(Transaction の一部)。 */
export interface ExistingTransactionLike {
  type: TransactionType;
  amount: number;
  date: string;
  store?: string;
  externalId?: string;
}

export interface PayPayImportPlan {
  /** 残高の記録(PayPay の入出金すべて)に足す行。 */
  ledgerToAdd: ParsedPayPayRow[];
  /** お金管理(支出・収入)に足す行。 */
  householdToAdd: PayPayHouseholdDraft[];
  /** すでにお金管理に入っているので、足さなかった行。 */
  householdDuplicates: PayPayHouseholdDraft[];
  /** チャージ・口座への送金など、財布の中の移動なのでお金管理に入れない行。 */
  internal: ParsedPayPayRow[];
  /** 手で入れた記録に、同じ日・同じ金額・同じ種類のものがある行(足したうえで、二重かもしれないと知らせる)。 */
  similarToManual: PayPayHouseholdDraft[];
}

function sameMoneyKey(t: { date: string; type: TransactionType; amount: number }): string {
  return `${t.date}|${t.type}|${t.amount}`;
}

/**
 * 取り込む前に、足す行と重複の行を分ける。
 *
 * 重複は「お金管理に今ある記録」と突き合わせる(以前は残高の記録の側だけを見ていたので、残高の記録に
 * 残っていればお金管理に無くても「重複」として飛ばし、いつまでも入らないことがあった)。
 * - 同じ取引(取引番号・内容・金額が同じ)がすでに入っていれば重複。
 * - 「CSVから取込」など別の取り込みで、同じ日・同じ金額・同じ種類のものが入っていても重複
 *   (同じファイルを別の入口から入れ直した時に、二重にしない)。1件の記録は1行とだけ対応させる
 *   (同じ日に同じ金額の支払いが2回あれば、2件ともあって初めて2行とも重複)。
 * - 手で入れた記録は消さずに比べるだけ: 同じ日・同じ金額があれば足したうえで知らせる
 *   (同じ日に同じ額を別の店で払うこともあるので、黙って飛ばさない)。
 */
export function planPayPayImport(
  rows: ParsedPayPayRow[],
  existingLedgerIds: Iterable<string>,
  existingTransactions: ExistingTransactionLike[],
): PayPayImportPlan {
  const ledgerSeen = new Set(existingLedgerIds);
  const idsInMoney = new Set(existingTransactions.flatMap((t) => (t.externalId ? [t.externalId] : [])));
  // 取り込みで入った記録の「日・種類・金額」の数。完全に同じ取引に当たったぶんは先に差し引く。
  const importedKeys = new Map<string, number>();
  const manualKeys = new Map<string, number>();
  for (const t of existingTransactions) {
    const target = t.externalId ? importedKeys : manualKeys;
    const key = sameMoneyKey(t);
    target.set(key, (target.get(key) ?? 0) + 1);
  }

  const plan: PayPayImportPlan = { ledgerToAdd: [], householdToAdd: [], householdDuplicates: [], internal: [], similarToManual: [] };
  const drafts: PayPayHouseholdDraft[] = [];
  const seenInFile = new Set<string>();
  for (const row of rows) {
    // 同じファイルの中で同じ行が2回出てきても、1回だけ数える。
    if (seenInFile.has(row.externalId)) continue;
    seenInFile.add(row.externalId);
    if (!ledgerSeen.has(row.externalId)) plan.ledgerToAdd.push(row);
    const entry = classifyForHousehold(row);
    if (!entry || entry.amount <= 0) {
      plan.internal.push(row);
      continue;
    }
    drafts.push({ row, entry });
  }

  const take = (map: Map<string, number>, key: string) => {
    const n = map.get(key) ?? 0;
    if (n <= 0) return false;
    map.set(key, n - 1);
    return true;
  };
  const keyOf = (d: PayPayHouseholdDraft) => sameMoneyKey({ date: d.row.date, type: d.entry.type, amount: d.entry.amount });

  // 1回目: 同じ取引がそのまま入っているもの。
  const rest: PayPayHouseholdDraft[] = [];
  for (const draft of drafts) {
    if (idsInMoney.has(draft.row.externalId)) {
      take(importedKeys, keyOf(draft));
      plan.householdDuplicates.push(draft);
    } else {
      rest.push(draft);
    }
  }
  // 2回目: 別の取り込みで、同じ日・同じ金額が入っているもの。
  for (const draft of rest) {
    if (take(importedKeys, keyOf(draft))) {
      plan.householdDuplicates.push(draft);
      continue;
    }
    plan.householdToAdd.push(draft);
    if (take(manualKeys, keyOf(draft))) plan.similarToManual.push(draft);
  }
  return plan;
}
