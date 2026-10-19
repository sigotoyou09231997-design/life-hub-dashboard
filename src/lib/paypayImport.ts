import { db } from "../db/schema";
import { toDateStr, todayStr } from "./date";
import { resolveCurrentPeriod } from "./payPeriod";
import { parsePayPayCsv, planPayPayImport, type PayPayHouseholdDraft } from "./paypayCsv";

/** 取り込んだ支出が「使えるお金」(給料 − 固定費 − その期の支出、src/hooks/usePayPeriodBudget.ts)にどう効いたか。 */
export interface PayPayBudgetEffect {
  /** 今の給料の期間の給与が登録されているか。無ければ、使えるお金は給与 0 円から引いた形になる。 */
  hasSalary: boolean;
  /** 今の給料の期間の初日(YYYY-MM-DD)。給与が1件も無い時は null。 */
  periodStart: string | null;
  /** 足した支出のうち、今の給料の期間に入るもの(使えるお金から引かれる)。 */
  inPeriodCount: number;
  inPeriodTotal: number;
  /** 足した支出のうち、今の給料の期間より前の日付のもの(使えるお金には入らない)。 */
  beforePeriodCount: number;
}

export interface PayPayImportOutcome {
  /** CSV の取引の行数。 */
  total: number;
  added: PayPayHouseholdDraft[];
  duplicates: number;
  internal: number;
  similarToManual: PayPayHouseholdDraft[];
  budget: PayPayBudgetEffect;
}

/** 足した支出が、今の給料の期間に入るか(src/lib/payPeriod.ts と同じ決め方)。 */
export function budgetEffectOf(
  added: PayPayHouseholdDraft[],
  period: { periodStart: string; hasSalary: boolean } | null,
  today: string,
): PayPayBudgetEffect {
  const expenses = added.filter((d) => d.entry.type === "expense");
  if (!period) {
    return { hasSalary: false, periodStart: null, inPeriodCount: 0, inPeriodTotal: 0, beforePeriodCount: 0 };
  }
  const inPeriod = expenses.filter((d) => d.row.date >= period.periodStart && d.row.date <= today);
  return {
    hasSalary: period.hasSalary,
    periodStart: period.periodStart,
    inPeriodCount: inPeriod.length,
    inPeriodTotal: inPeriod.reduce((sum, d) => sum + d.entry.amount, 0),
    beforePeriodCount: expenses.filter((d) => d.row.date < period.periodStart).length,
  };
}

/**
 * PayPay の取引履歴の CSV(文字にしたもの)を取り込む。読めなかった時は null。
 * 「PayPay」の画面と「CSVから取込」の両方から呼ぶ(どちらから入れても、同じ読み方・同じ重複の判定になるように)。
 */
export async function importPayPayCsvText(text: string): Promise<PayPayImportOutcome | null> {
  const rows = parsePayPayCsv(text);
  if (rows.length === 0) return null;

  const [ledger, transactions, salaries] = await Promise.all([
    db.paypayTransactions.toArray(),
    db.transactions.toArray(),
    db.salaries.toArray(),
  ]);
  const plan = planPayPayImport(
    rows,
    ledger.map((entry) => entry.externalId),
    transactions,
  );

  const now = Date.now();
  // お金管理を先に書く。残高の記録だけが先に入って、お金管理に入らないまま「取り込み済み」に見える形を作らない。
  if (plan.householdToAdd.length > 0) {
    await db.transactions.bulkAdd(
      plan.householdToAdd.map(({ row, entry }) => ({
        type: entry.type,
        amount: entry.amount,
        category: entry.category,
        store: entry.store,
        memo: entry.memo,
        method: "電子マネー",
        date: row.date,
        isFixed: false,
        externalId: row.externalId,
        createdAt: now,
      })),
    );
  }
  if (plan.ledgerToAdd.length > 0) {
    await db.paypayTransactions.bulkAdd(
      plan.ledgerToAdd.map((row) => ({
        externalId: row.externalId,
        date: row.date,
        amount: row.amount,
        content: row.content,
        counterparty: row.counterparty,
        importedAt: now,
      })),
    );
  }

  const period = resolveCurrentPeriod(salaries, new Date());
  return {
    total: rows.length,
    added: plan.householdToAdd,
    duplicates: plan.householdDuplicates.length,
    internal: plan.internal.length,
    similarToManual: plan.similarToManual,
    budget: budgetEffectOf(
      plan.householdToAdd,
      period ? { periodStart: toDateStr(period.periodStart), hasSalary: period.hasSalaryForPeriod } : null,
      todayStr(),
    ),
  };
}
