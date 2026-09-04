import type { PendingCardCharge, Transaction } from "../types";

/**
 * カードの「使ったが、まだ引き落とされていない」利用を、残額の計算に先取りで入れる。
 *
 * ## 二重計上をどう避けるか
 *
 * 確定したかどうかを未確定側の行に印として持たない。**同じ買い物の支出
 * (Transaction)が既にあるかを、その都度見て決める。** 印を持つやり方だと、
 * あとで支出の側を消したときにここだけ「確定済み」のまま取り残されて、
 * その利用がどちらの数にも入らなくなる。
 *
 * 「同じ買い物」と見なすのは次のどちらか。
 *
 *  1. この画面の「支出にする」で作った支出 — externalId が一致する(確実)。
 *  2. 本人が別に記録した支出 — 利用日と金額が両方とも一致する(見込み)。
 *     カード明細の利用日と手で付けた日付は同じ日になることが多く、
 *     金額まで一致する別の買い物が同じ日にある確率は低い。外した場合は
 *     残額を実際より少なく見せる側に倒れる(使いすぎるより安全)。
 */

/** 「支出にする」で作った支出に付ける印。取り込み時の externalId から作る。 */
export function settledExternalId(chargeExternalId: string): string {
  return `card-pending:${chargeExternalId}`;
}

/** その利用が、もう支出として記録されているか。 */
export function isSettled(charge: PendingCardCharge, transactions: Transaction[]): boolean {
  const marker = settledExternalId(charge.externalId);
  return transactions.some(
    (transaction) =>
      transaction.externalId === marker ||
      (transaction.type === "expense" && transaction.date === charge.date && transaction.amount === charge.amount),
  );
}

/** まだ支出になっていない利用だけ。新しい利用が上に来る順で返す。 */
export function unsettledCharges(charges: PendingCardCharge[], transactions: Transaction[]): PendingCardCharge[] {
  return charges
    .filter((charge) => !isSettled(charge, transactions))
    .sort((a, b) => b.date.localeCompare(a.date) || b.importedAt - a.importedAt);
}

/**
 * 残額から先に引く金額。
 *
 * 期の初日より前の利用は数えない — 前の期の給与から払うぶんなので、今期の残額から
 * 引くと二重に減る。期の終わり側は区切らない(未確定の利用はこれから引き落とされる)。
 */
export function unsettledTotal(
  charges: PendingCardCharge[],
  transactions: Transaction[],
  periodStart: string,
): number {
  return unsettledCharges(charges, transactions)
    .filter((charge) => charge.date >= periodStart)
    .reduce((sum, charge) => sum + charge.amount, 0);
}

/** 取り込み時に作る行。CSVの1行ぶん。 */
export interface PendingChargeDraft {
  externalId: string;
  date: string;
  amount: number;
  store?: string;
  memo?: string;
}

export interface PendingImportPlan {
  /** これから足す行。 */
  added: PendingChargeDraft[];
  /** 既に取り込み済みで飛ばした件数。 */
  duplicates: number;
}

/**
 * 取り込む行を、既に入っているものと突き合わせて仕分ける。
 * 同じCSVを2回読んでも増えないようにするためのもの(PayPay取込と同じ考え方)。
 */
export function planPendingImport(
  drafts: PendingChargeDraft[],
  existing: PendingCardCharge[],
): PendingImportPlan {
  const seen = new Set(existing.map((charge) => charge.externalId));
  const added: PendingChargeDraft[] = [];
  let duplicates = 0;
  for (const draft of drafts) {
    if (seen.has(draft.externalId)) {
      duplicates++;
      continue;
    }
    seen.add(draft.externalId);
    added.push(draft);
  }
  return { added, duplicates };
}
