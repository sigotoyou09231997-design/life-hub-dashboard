/**
 * 旅行の表紙の「色の面」(2026-11-27、見せる品質 その3)。
 *
 * 写真が無い旅行(デモ・地図のキーが無い時)は、同梱の写真(建物・海など)が行き先と合わず、
 * 「秋の京都」がコンクリートの部屋に見えていた。本人は「画像は入れなくていい」と言っているので、
 * 写真の代わりに「行き先ごとの淡い色の面＋大きな地名」を表紙にする。
 * 色は白地・深い青緑・黒の決まりを崩さない淡い6色から、行き先の名前で決める(同じ旅行はいつも同じ色)。
 */
export interface TripCoverTone {
  /** 面の色(淡い)。 */
  bg: string;
  /** 面の上の文字・葉の印の色(白地で 4.5:1 以上になる濃さ)。 */
  ink: string;
}

export const TRIP_COVER_TONES: TripCoverTone[] = [
  { bg: "#e3efec", ink: "#1b5e57" }, // 青緑
  { bg: "#f1ebe0", ink: "#6b4f2a" }, // 砂
  { bg: "#e4ecf4", ink: "#2b4c6f" }, // 空
  { bg: "#f3e7e4", ink: "#7a3b33" }, // 紅葉
  { bg: "#e8efe0", ink: "#3f5a2a" }, // 若草
  { bg: "#ebe8f2", ink: "#4b3f6b" }, // 藤
];

export function tripCoverTone(seed: string): TripCoverTone {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TRIP_COVER_TONES[hash % TRIP_COVER_TONES.length];
}

/** 表紙に大きく出す地名。行き先があれば行き先(区切りの手前)、無ければ旅行の名前。 */
export function tripCoverPlace(name: string, destination: string): string {
  const head = (destination || "").split(/[・、,，/／（(]/)[0]?.trim();
  return head || name.trim();
}
