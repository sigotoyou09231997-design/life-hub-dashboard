import { useEffect, useState } from "react";
import type { SyncedEmail } from "../types";
import { todayStr } from "../lib/date";
import { isExpenseSuggestion } from "../lib/expenseMailSuggestion";
import { isPlanSuggestion } from "../lib/mailPlanSuggestion";

export interface MailSuggestions {
  /** 予定になりそうなメール。 */
  plan: SyncedEmail[];
  /** 注文確認・領収書らしいメール。 */
  expense: SyncedEmail[];
}

interface Computed extends MailSuggestions {
  accountId: string;
}

/** 1回に判定に使う時間(ミリ秒)。これを超えたら一度手放して、画面の描き直しや指の操作に譲る。 */
const SLICE_MS = 10;

/** 直前の結果(アカウントごと)。開き直した最初の描画から、候補の印と件数を出すため。 */
const lastResult = new Map<string, Computed>();

/**
 * Gmail の一覧の「予定候補」「支出候補」を、画面を止めずに求める(2026-10-13、本人「Gmailを押した時だけ
 * 切り替わるのが遅い」)。
 *
 * 全メールの本文を調べる判定は重く、数百〜千通だと iPhone では画面が数秒止まっていた。しかも
 * 描き直すたび(検索で1文字打つたびにも)全件をやり直していた。ここでは
 *  - 画面を描いたあとに、10ミリ秒ずつ区切って判定する(区切りの間に描き直しと指の操作が通る)
 *  - 同じメールの判定結果は、判定の側が覚えている(src/lib/mailPlanSuggestion.ts ほか)ので、2回目以降は速い
 *  - メールの並びが変わらない限り、やり直さない(emails は同じ値を渡し続けること)
 * 終わるまでは、前の結果(開き直した時は直前の結果)をそのまま返す。
 */

/**
 * 判定を、10ミリ秒ずつ区切って始める。終わると、そのアカウントの結果を控えて onDone に渡す。
 * 返り値は、途中でやめるための関数。
 */
export function startMailSuggestions(
  accountId: string,
  emails: SyncedEmail[],
  onDone?: (done: Computed) => void,
): () => void {
  let cancelled = false;
  let timer: number | undefined;
  let index = 0;
  const plan: SyncedEmail[] = [];
  const expense: SyncedEmail[] = [];
  const today = todayStr();

  const step = () => {
    if (cancelled) return;
    const deadline = performance.now() + SLICE_MS;
    while (index < emails.length && performance.now() < deadline) {
      const email = emails[index++];
      if (isPlanSuggestion(email, today)) plan.push(email);
      if (isExpenseSuggestion(email)) expense.push(email);
    }
    if (index < emails.length) {
      timer = window.setTimeout(step, 0);
      return;
    }
    const done = { accountId, plan, expense };
    lastResult.set(accountId, done);
    onDone?.(done);
  };
  step();

  return () => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

export function useMailSuggestions(
  accountId: string | undefined,
  emails: SyncedEmail[] | undefined,
): MailSuggestions | undefined {
  const [computed, setComputed] = useState<Computed | undefined>(undefined);

  useEffect(() => {
    if (!accountId || !emails) return;
    return startMailSuggestions(accountId, emails, setComputed);
  }, [accountId, emails]);

  if (!accountId) return undefined;
  // 別のアカウントの結果は使わない。計算中は、そのアカウントの直前の結果(あれば)を返す。
  return computed?.accountId === accountId ? computed : lastResult.get(accountId);
}
