import { useEffect } from "react";
import {
  lastSoccerSyncAt,
  loadSoccerTeams,
  shouldAutoSyncSoccer,
  soccerSyncIsCurrent,
  syncSoccerFixtures,
} from "../lib/soccerFixtures";
import { markSoccerTeamsChecked, shouldCheckSoccerTeams, syncSoccerTeams } from "../lib/soccerTeamsSync";

/** 開いてすぐは、画面を出すこと・予定を読むことを優先する。サッカーの取り込みはその後に回す。 */
const START_DELAY_MS = 4000;

/**
 * 画面を開いた時に、選んだチームの試合日程を取り込み直す(src/lib/soccerFixtures.ts)。
 * - **開いて4秒たってから**走らせる(起動を重くしない。2026-10-25、本人「アプリの起動が重たい」)。
 * - 別の端末で選んだチームへの追いつき(src/lib/soccerTeamsSync.ts)は、前回から10分たっていなければ、通信しない。
 * - 前回の取り込みから6時間たっていなければ見送る。ただし、予定の書き方を変えた版(SOCCER_SYNC_VERSION)になった時は、
 *   待たずに書き直す。
 * 失敗してもトーストは出さない(開くたびに出ても邪魔なだけで、設定の「海外サッカー」の「今すぐ取り込む」で理由が見える)。
 */
export function useSoccerAutoSync(): void {
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const now = Date.now();
        let teams = loadSoccerTeams();
        if (shouldCheckSoccerTeams(now)) {
          teams = await syncSoccerTeams();
          markSoccerTeamsChecked(now);
        }
        if (cancelled) return;
        if (shouldAutoSyncSoccer(teams, lastSoccerSyncAt(), Date.now(), soccerSyncIsCurrent())) {
          await syncSoccerFixtures(teams).catch(() => undefined);
        }
      })();
    }, START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
}
