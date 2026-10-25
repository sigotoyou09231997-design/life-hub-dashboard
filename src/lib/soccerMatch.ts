import type { CalendarEvent } from "../types";

/**
 * 取り込んだサッカーの試合かどうか・紋章と題名を、予定から読み取る(予定の形は変えず、メモの印と題名から読む)。
 * 画面(カレンダー・予定の一覧)が紋章を出すのに使う。データベースには触らないので、どの画面からでも読める。
 *
 * メモの印は `ESPN#<試合id> (<ホームのid>-<アウェイのid>)`(src/lib/soccerFixtures.ts が書く)。
 * かっこの部分が無い古い予定でも、試合として扱い、紋章だけ出さない。
 */

export const SOCCER_TITLE_PREFIX = "⚽ ";
const MARKER_RE = /ESPN#(\d+)(?: \((\d+)-(\d+)\))?/;

export interface SoccerMatchInfo {
  espnId: string;
  homeId?: string;
  awayId?: string;
  /** 「⚽ 」を除いた題名。例: リバプール vs ブライトン */
  title: string;
  /** 題名を「 vs 」で分けた、ホーム側・アウェイ側のチーム名。分けられない題名は、全体がホーム側。 */
  homeName: string;
  awayName?: string;
  /** 大会名(メモの先頭の行)。例: プレミアリーグ */
  competition?: string;
  /** U-NEXT で配信している試合か(メモに書いてある)。 */
  unext: boolean;
}

/** チームの紋章(ESPN の画像)。元は500pxで1枚36KBほどあり、小さく出すだけなので、ESPN の画像サーバーで64pxに縮めたものを読む(5KBほど)。 */
export function soccerCrestUrl(teamId: string): string {
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/${encodeURIComponent(teamId)}.png&w=64&h=64`;
}

export function parseSoccerMatch(event: Pick<CalendarEvent, "memo" | "title">): SoccerMatchInfo | null {
  const memo = event.memo ?? "";
  const marker = MARKER_RE.exec(memo);
  if (!marker) return null;
  const first = memo.split("\n")[0]?.trim();
  const competition = first && !first.startsWith("配信:") && !first.startsWith("日本時間") && !first.startsWith("キックオフ") ? first : undefined;
  const title = event.title.startsWith(SOCCER_TITLE_PREFIX) ? event.title.slice(SOCCER_TITLE_PREFIX.length) : event.title;
  const versus = title.indexOf(" vs ");
  return {
    espnId: marker[1],
    ...(marker[2] && marker[3] ? { homeId: marker[2], awayId: marker[3] } : {}),
    title,
    homeName: versus >= 0 ? title.slice(0, versus) : title,
    ...(versus >= 0 ? { awayName: title.slice(versus + 4) } : {}),
    ...(competition ? { competition } : {}),
    unext: memo.includes("U-NEXT"),
  };
}
