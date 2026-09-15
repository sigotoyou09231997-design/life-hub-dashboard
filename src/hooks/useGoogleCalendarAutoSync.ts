import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { shouldAutoSyncCalendar, syncGoogleCalendar } from "../lib/googleCalendar";

/**
 * 画面を開いた時に、Googleカレンダーの取り込みを入にしてあるアカウントぶんを取り込む
 * (src/lib/googleCalendar.ts)。前回から10分たっていなければ見送る。
 * 結果はトーストに出さない — 開くたびに「変更はありませんでした」が出ても邪魔なだけで、
 * 失敗の理由は設定画面のアカウント欄に残る。
 *
 * 取り込むとアカウントの行(最後に試した時刻)が変わってこの効果がもう一度走るが、
 * 間隔の判定で止まる。同時に2本走らないようにするのは syncGoogleCalendar 側。
 */
export function useGoogleCalendarAutoSync(): void {
  const accounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  useEffect(() => {
    const now = Date.now();
    for (const account of accounts ?? []) {
      if (shouldAutoSyncCalendar(account, now)) void syncGoogleCalendar(account);
    }
  }, [accounts]);
}
