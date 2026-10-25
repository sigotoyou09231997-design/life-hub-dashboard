import { useEffect } from "react";
import {
  lastSoccerSyncAt,
  shouldAutoSyncSoccer,
  soccerSyncIsCurrent,
  syncSoccerFixtures,
} from "../lib/soccerFixtures";
import { syncSoccerTeams } from "../lib/soccerTeamsSync";

/**
 * 画面を開いた時に、選んだチームの試合日程を取り込み直す(src/lib/soccerFixtures.ts)。
 * 先に、別の端末で選んだチームに追いつく(src/lib/soccerTeamsSync.ts)。
 * 前回から6時間たっていなければ見送る。ただし、予定の書き方を変えた版(SOCCER_SYNC_VERSION)になった時は、
 * 待たずに書き直す。失敗してもトーストは出さない(開くたびに出ても邪魔なだけで、
 * 設定の「海外サッカー」の「今すぐ取り込む」で理由が見える)。
 */
export function useSoccerAutoSync(): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const teams = await syncSoccerTeams();
      if (cancelled) return;
      if (shouldAutoSyncSoccer(teams, lastSoccerSyncAt(), Date.now(), soccerSyncIsCurrent())) {
        await syncSoccerFixtures(teams).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
