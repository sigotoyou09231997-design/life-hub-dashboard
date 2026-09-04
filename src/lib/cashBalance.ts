import type { Settings, Transaction } from "../types";

/** 支払い方法が「現金」として記録された収支。PAYMENT_METHODS(src/lib/categories.ts)の値。 */
export const CASH_METHOD = "現金";

export interface CashBalanceView {
  /** 手入力した額に、それ以降の現金の収支を足し引きした推定額。 */
  estimated: number;
  /** 手入力した額そのもの。 */
  baseline: number;
  /** 手入力した時刻(epoch ms)。0 なら一度も入力していない。 */
  anchor: number;
  /** 推定に効いている収支の件数。0 なら手入力した額のまま。 */
  countedTransactions: number;
}

/** 起点より後に記録された現金の収支だけを足し引きする。
 * PayPay残高(PayPayImport.tsx)と同じ考え方で、日付ではなく「記録した時刻」で切る —
 * 過去の日付をあとから入力することがあり、日付で切ると起点の前に入れた実績まで
 * 二重に引いてしまうため。 */
export function cashDelta(transactions: Transaction[], anchor: number): { delta: number; counted: number } {
  let delta = 0;
  let counted = 0;
  for (const transaction of transactions) {
    if (transaction.method !== CASH_METHOD) continue;
    if (transaction.createdAt <= anchor) continue;
    delta += transaction.type === "income" ? transaction.amount : -transaction.amount;
    counted++;
  }
  return { delta, counted };
}

export function viewCashBalance(settings: Settings | undefined, transactions: Transaction[]): CashBalanceView {
  const baseline = settings?.cashBalance ?? 0;
  const anchor = settings?.cashBalanceUpdatedAt ?? 0;
  const { delta, counted } = cashDelta(transactions, anchor);
  return { estimated: baseline + delta, baseline, anchor, countedTransactions: counted };
}
