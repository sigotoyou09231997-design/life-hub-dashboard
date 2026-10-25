import { useEffect } from "react";
import { lastSoccerSyncAt, loadSoccerTeams, shouldAutoSyncSoccer, syncSoccerFixtures } from "../lib/soccerFixtures";

/**
 * 画面を開いた時に、選んだチームの試合日程を取り込み直す(src/lib/soccerFixtures.ts)。
 * 前回から6時間たっていなければ見送る。失敗してもトーストは出さない(開くたびに出ても邪魔なだけで、
 * 設定の「海外サッカー」の「今すぐ取り込む」で理由が見える)。
 */
export function useSoccerAutoSync(): void {
  useEffect(() => {
    const teams = loadSoccerTeams();
    if (shouldAutoSyncSoccer(teams, lastSoccerSyncAt(), Date.now())) void syncSoccerFixtures(teams).catch(() => undefined);
  }, []);
}
