#!/usr/bin/env node
// 修正を出すのにかかった時間の記録(.fix-times.log。scripts/ship.sh が出すたびに書く)を、表にして見る。
//   node scripts/fix-times.mjs            全部
//   node scripts/fix-times.mjs 10         直近 10 件
//
// 列: 日時 / 版 / 依頼→開始(見つけて・調べて・直す) / テスト・統合 / 公開待ち / 依頼→公開(依頼の時刻が分かる時だけ) / 内容
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".fix-times.log");
if (!existsSync(file)) {
  console.log("まだ記録がありません(scripts/ship.sh で出すと、1行ずつ溜まります)");
  process.exit(0);
}
const limit = Number(process.argv[2]) || Infinity;
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
  const [at, sha, wait, test, live, total, ...msg] = line.split("\t");
  const n = (v) => (v === "-" || v === undefined ? null : Number(v));
  return { at, sha, wait: n(wait), test: n(test), live: n(live), total: n(total), msg: msg.join("\t"), failed: sha === "失敗" };
}).slice(-limit);

const fmt = (sec) => (sec === null || Number.isNaN(sec) ? "   -  " : sec >= 90 ? `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, "0")}秒` : `${sec}秒`).padStart(7);
console.log("日時                 版       依頼→開始  テスト・統合  公開待ち  依頼→公開  内容");
for (const r of rows) {
  if (r.failed) {
    // 止まった反映。test 列に、開始から止まるまでの秒数が入っている。
    console.log(`${r.at}  ✗失敗     (反映が止まった: ${fmt(r.test).trim()}で)                          ${r.msg.slice(0, 50)}`);
    continue;
  }
  console.log(`${r.at}  ${r.sha}  ${fmt(r.wait)}   ${fmt(r.test)}     ${fmt(r.live)}  ${fmt(r.wait === null ? null : r.total)}   ${r.msg.slice(0, 40)}`);
}
const okRows = rows.filter((r) => !r.failed);
const avg = (key) => {
  const xs = okRows.map((r) => r[key]).filter((v) => v !== null && !Number.isNaN(v));
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
};
const failedCount = rows.filter((r) => r.failed).length;
console.log(`\n平均(成功 ${okRows.length}件${failedCount ? `・止まった反映 ${failedCount}回` : ""})  依頼→開始 ${fmt(avg("wait")).trim()} / テスト・統合 ${fmt(avg("test")).trim()} / 公開待ち ${fmt(avg("live")).trim()}`);
