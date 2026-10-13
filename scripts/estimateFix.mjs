// 修正にかかる時間の見積もり(scripts/estimate-fix.mjs が使う、計算だけの部分。試験できる)。
//
// 材料は .fix-times.log(scripts/ship.sh が出すたびに1行書く)。内容の「大きさ」ごとに、これまでの「依頼→公開」の時間を集めて、
// 真ん中の値(中央値)と、ばらつきの範囲(4分位)を出す。件数が少ないものは、少ないと正直に言う。

export const SIZES = {
  出し直し: "コードは変えず、更新履歴・SQL を流したあとの反映だけを出す",
  小: "1〜2か所の直し(文言・色・余白・小さな不具合)",
  中: "1つの機能の追加・変更(複数のファイルと、そのテスト)",
  広い見た目: "全画面にまたがる見た目の変更(機械での検査つき)",
  大: "SQL・同期・複数の機能にまたがる新機能",
  道具: "開発の道具(出す仕組み・計測)",
};

/** ログの1行 → 行。止まった反映(失敗)・時間が分からない行は total を null にする。8列目が大きさ(古い行には無い)。 */
export function parseFixLog(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [at, sha, wait, test, live, total, msg, size] = line.split("\t");
      const n = (v) => (v === undefined || v === "-" || v === "" ? null : Number(v));
      const failed = sha === "失敗";
      return { at, sha, wait: n(wait), test: n(test), live: n(live), total: failed ? null : n(total), msg: msg ?? "", size: size?.trim() || null, failed };
    });
}

/** 並べた数の、q(0〜1)の位置の値(間は直線でつなぐ)。 */
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

/** 分に直す(1分未満は1分に)。 */
const toMinutes = (sec) => Math.max(1, Math.round(sec / 60));

/**
 * 大きさごとの見積もり。
 * - 件数が4件以上: 4分位(25%〜75%)を範囲、中央値を目安にする。
 * - 1〜3件: 最小〜最大を範囲にして「データ不足」と言う(目安は中央値)。
 * - 0件: 見積もれない(null)。
 * 信頼の言い方: 8件以上=十分 / 4〜7件=少なめ / 1〜3件=不足。
 */
export function estimateFor(rows, size) {
  const times = rows
    .filter((r) => !r.failed && r.size === size && r.total !== null && Number.isFinite(r.total))
    .map((r) => r.total)
    .sort((a, b) => a - b);
  const n = times.length;
  if (n === 0) return null;
  const [low, high] = n >= 4 ? [quantile(times, 0.25), quantile(times, 0.75)] : [times[0], times[n - 1]];
  const mid = quantile(times, 0.5);
  return {
    size,
    n,
    lowMin: toMinutes(low),
    midMin: toMinutes(mid),
    highMin: Math.max(toMinutes(high), toMinutes(low)),
    confidence: n >= 8 ? "十分" : n >= 4 ? "少なめ" : "不足",
  };
}

/** 大きさごとの一覧(大きさの名前の並び順)。 */
export function estimateAll(rows) {
  return Object.keys(SIZES).map((size) => estimateFor(rows, size) ?? { size, n: 0, lowMin: null, midMin: null, highMin: null, confidence: "不足" });
}

/** 画面に出す言い方。 */
export function describeEstimate(e) {
  if (!e || e.n === 0) return "見積もれません(この大きさの実績がまだ無い)";
  const range = e.lowMin === e.highMin ? `約${e.midMin}分` : `約${e.lowMin}〜${e.highMin}分(目安 ${e.midMin}分)`;
  return `${range}(実績 ${e.n}件・データ${e.confidence})`;
}
