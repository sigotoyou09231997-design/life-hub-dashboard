/**
 * 個人開発の案件タグと、その年間集計。
 *
 * 「案件ごとにタグを付けた支出・収入を、確定申告のために年間でまとめて書き出す」ための
 * もの(2026-09-04の回答: タグは自由入力のテキストで十分、出力はタグ別→その中で月別)。
 *
 * **タグは支出・収入の行(Transaction)には持たせない。** transactions は Supabase へ
 * 同期していて、列を足すと人が本番でSQLを流すまで同期が失敗する。現地通貨の内訳
 * (src/lib/currency.ts)と同じく、端末内の別テーブルに逃がしてある。
 *
 * この作りの限界として、**タグは付けた端末にしか無い。** PCで付けたタグはスマホから
 * 見えず、スマホ側で年間集計を出すとそのぶんが抜ける。確定申告に使うものなので、
 * 集計を出す端末は1つに決めておくこと(バックアップの書き出し・読み込みでは一緒に運べる)。
 */

import { db } from "../db/schema";
import type { Transaction, TransactionProjectTag } from "../types";
import { csvCell } from "./transactionCsv";

/** 支出・収入idごとのタグ。一覧で1件ずつ引かずに済むよう、まとめて表にする。 */
export function tagsByTransactionId(rows: TransactionProjectTag[]): Map<string, string> {
  return new Map(rows.map((row) => [row.transactionId, row.tag]));
}

/** 今までに使ったタグ(五十音・アルファベット順)。入力欄の候補に出す。 */
export function knownProjectTags(rows: TransactionProjectTag[]): string[] {
  return [...new Set(rows.map((row) => row.tag.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

export async function loadProjectTag(transactionId: string): Promise<string> {
  const existing = await db.transactionProjectTags.where("transactionId").equals(transactionId).first();
  return existing?.tag ?? "";
}

/** 1件の収支につきタグは1つだけ持つ。空にしたら行ごと消す。 */
export async function saveProjectTag(transactionId: string, tag: string): Promise<void> {
  const trimmed = tag.trim();
  const existing = await db.transactionProjectTags.where("transactionId").equals(transactionId).first();

  if (!trimmed) {
    if (existing?.id) await db.transactionProjectTags.delete(existing.id);
    return;
  }

  if (existing?.id) {
    await db.transactionProjectTags.update(existing.id, { tag: trimmed });
  } else {
    await db.transactionProjectTags.add({ transactionId, tag: trimmed, createdAt: Date.now() });
  }
}

export async function deleteProjectTagFor(transactionId: string): Promise<void> {
  await db.transactionProjectTags.where("transactionId").equals(transactionId).delete();
}

/* --- 年間集計 -------------------------------------------------------------- */

/** 案件1件の、ある月の内訳。 */
export interface ProjectMonthTotal {
  /** "2026-04" の月の部分だけ。1〜12。 */
  month: number;
  income: number;
  expense: number;
  /** 収入 - 支出。 */
  net: number;
}

export interface ProjectYearSummary {
  tag: string;
  /** 記録のある月だけ、1月から順に。 */
  months: ProjectMonthTotal[];
  income: number;
  expense: number;
  net: number;
}

/**
 * 暦年(1月〜12月)で、案件別→月別にまとめる。
 *
 * 年を暦年で切るのは確定申告に合わせるため。タグの付いていない収支は入れない
 * (依頼のとおり「タグを付けたものだけ案件別集計に出る」)。
 */
export function summarizeProjectYear(
  transactions: Transaction[],
  tags: Map<string, string>,
  year: number,
): ProjectYearSummary[] {
  const prefix = `${year}-`;
  const byTag = new Map<string, Map<number, ProjectMonthTotal>>();

  for (const transaction of transactions) {
    if (!transaction.id || !transaction.date.startsWith(prefix)) continue;
    const tag = tags.get(transaction.id);
    if (!tag) continue;

    const month = Number(transaction.date.slice(5, 7));
    if (!Number.isFinite(month) || month < 1 || month > 12) continue;

    let months = byTag.get(tag);
    if (!months) {
      months = new Map();
      byTag.set(tag, months);
    }
    let total = months.get(month);
    if (!total) {
      total = { month, income: 0, expense: 0, net: 0 };
      months.set(month, total);
    }
    if (transaction.type === "income") total.income += transaction.amount;
    else total.expense += transaction.amount;
    total.net = total.income - total.expense;
  }

  return [...byTag.entries()]
    .map(([tag, months]) => {
      const sorted = [...months.values()].sort((a, b) => a.month - b.month);
      const income = sorted.reduce((sum, m) => sum + m.income, 0);
      const expense = sorted.reduce((sum, m) => sum + m.expense, 0);
      return { tag, months: sorted, income, expense, net: income - expense };
    })
    .sort((a, b) => a.tag.localeCompare(b.tag, "ja"));
}

export const PROJECT_CSV_HEADER = ["案件", "月", "収入", "支出", "差引"] as const;

/**
 * 案件別→月別のCSV。案件ごとに、記録のある月を並べたあと「合計」の行を挟む。
 * 最後に全案件をまとめた行を1つ置く(その年ぜんぶでいくらだったかを見るため)。
 */
export function buildProjectCsv(summaries: ProjectYearSummary[]): string {
  const rows: string[] = [PROJECT_CSV_HEADER.join(",")];

  for (const summary of summaries) {
    for (const month of summary.months) {
      rows.push(
        [
          csvCell(summary.tag),
          `${month.month}月`,
          String(Math.round(month.income)),
          String(Math.round(month.expense)),
          String(Math.round(month.net)),
        ].join(","),
      );
    }
    rows.push(
      [
        csvCell(summary.tag),
        "合計",
        String(Math.round(summary.income)),
        String(Math.round(summary.expense)),
        String(Math.round(summary.net)),
      ].join(","),
    );
  }

  if (summaries.length > 0) {
    const income = summaries.reduce((sum, s) => sum + s.income, 0);
    const expense = summaries.reduce((sum, s) => sum + s.expense, 0);
    rows.push(
      ["全案件", "合計", String(Math.round(income)), String(Math.round(expense)), String(Math.round(income - expense))].join(
        ",",
      ),
    );
  }

  return rows.join("\r\n");
}

export function projectCsvFilename(year: number): string {
  return `life-hub-projects-${year}.csv`;
}

/** 書き出せる年の候補(記録のある年だけ、新しい順)。 */
export function yearsWithProjectRecords(transactions: Transaction[], tags: Map<string, string>): number[] {
  const years = new Set<number>();
  for (const transaction of transactions) {
    if (!transaction.id || !tags.has(transaction.id)) continue;
    const year = Number(transaction.date.slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}
