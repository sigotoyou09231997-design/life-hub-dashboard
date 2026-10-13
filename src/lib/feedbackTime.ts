/**
 * 修正依頼が届いてからの経過(2026-10-14、本人「いつ修正依頼が届いたかの時間も出して欲しい」)。
 * 「10/14 7:45 に届きました(18分前)」の、括弧の中。計算だけの部分。
 */
export function agoLabel(iso: string, nowMs: number): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  // 端末の時計が少し遅れて、届いた時刻が「未来」になっても、マイナスにはしない。
  const minutes = Math.max(0, Math.floor((nowMs - at) / 60_000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}
