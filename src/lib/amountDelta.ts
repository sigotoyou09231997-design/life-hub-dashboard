/**
 * 金額が変わった時の「数字が動く」演出の、計算だけの部分(UI/UX 調査メモ 第4弾 A-5)。
 *
 * ホームの「今月の支出」に、記録した額が「+¥1,280」と浮かんでから合計に入り、合計は
 * 前の値から新しい値へ数え上がる。画面に依存しない判断(動かすかどうか・何円ぶんか・
 * 途中の値)をここに集め、src/hooks/useAmountTransition.ts が画面側を受け持つ。
 */

/** 前に描いた値。key は「同じものを数えているか」の印(今月の支出なら月の初日)。 */
export interface AmountSnapshot {
  value: number | undefined;
  key?: string;
}

/**
 * 前の値から何円動いたか。動かさなくてよい時は 0。
 *
 * - 開いた直後(前の値が無い・まだ読み込み中)は 0 — その時は今までどおり、
 *   useDesignMotion.ts が 0 から数え上げる。
 * - 数えている物そのものが替わった時(月が替わった・給料日が来た)も 0。
 *   合計が 0 に戻るのは「使ったお金が減った」のではないので、「−¥…」を浮かべない。
 */
export function amountDelta(prev: AmountSnapshot | undefined, next: AmountSnapshot): number {
  if (!prev) return 0;
  if (prev.value === undefined || next.value === undefined) return 0;
  if (!Number.isFinite(prev.value) || !Number.isFinite(next.value)) return 0;
  if ((prev.key ?? "") !== (next.key ?? "")) return 0;
  const delta = Math.round(next.value) - Math.round(prev.value);
  return delta === 0 ? 0 : delta;
}

/**
 * 浮かべる差額の文字。「+¥1,280」「−¥1,280」。
 * 記号は履歴の一覧(ExpenseSummary.tsx の「+」「−」)とそろえ、半角の + と
 * 数学のマイナス(U+2212)にする。数字用の文字(B-1, Manrope)がどちらも持っているので、
 * 全角の「＋」のように数字と書体が分かれない。
 */
export function formatSignedYen(delta: number): string {
  const rounded = Math.round(delta);
  const sign = rounded < 0 ? "−" : "+";
  return `${sign}¥${Math.abs(rounded).toLocaleString("en-US")}`;
}

/** 数え上げの曲線。最初に速く、最後はゆっくり止まる。 */
export function easeOutCubic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(1 - t, 3);
}

/** from から to へ、進み具合 t(0〜1) のときに見せる値。整数の円で返す。 */
export function tweenAmount(from: number, to: number, t: number): number {
  if (t >= 1) return to;
  if (t <= 0) return from;
  return Math.round(from + (to - from) * easeOutCubic(t));
}
