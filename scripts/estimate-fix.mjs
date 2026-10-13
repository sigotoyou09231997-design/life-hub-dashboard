#!/usr/bin/env node
// 修正にかかる時間の見積もり(2026-10-14、本人「修正依頼が来たら、どれくらいかかるか出して」)。
//
//   node scripts/estimate-fix.mjs                一覧(大きさごとの実績と目安)
//   node scripts/estimate-fix.mjs 中              その大きさの目安(例: 約5〜6分(目安 6分)(実績 11件・データ十分))
//   node scripts/estimate-fix.mjs 中 --json       機械で読める形(feedback-inbox.mjs --working <id> --estimate <分> に、midMin を渡す)
//
// 大きさ: 出し直し / 小 / 中 / 広い見た目 / 大 / 道具(意味は scripts/estimateFix.mjs の SIZES)。
// 依頼を直し始める時に、内容を見て大きさを決め、ここで目安を出して、アプリに「修正中・目安○分」を出す。
// ship.sh は --size <大きさ> を付けて出すと、その実績が次の見積もりの材料になる(付けないと材料にならない)。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIZES, describeEstimate, estimateAll, estimateFor, parseFixLog } from "./estimateFix.mjs";

// 記録は、作業場所(git worktree)の中ではなく、本体のフォルダに1つだけある(ship.sh が書く場所)。どこから走らせても、そこを見る。
function findLog() {
  const here = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: here, encoding: "utf8" }).trim();
    return join(dirname(common), ".fix-times.log");
  } catch {
    return join(here, ".fix-times.log");
  }
}
const logFile = findLog();
const rows = existsSync(logFile) ? parseFixLog(readFileSync(logFile, "utf8")) : [];
const args = process.argv.slice(2);
const json = args.includes("--json");
const size = args.find((arg) => !arg.startsWith("--"));

if (!size) {
  console.log("大きさ        実績   目安(中央値)  範囲        データ");
  for (const e of estimateAll(rows)) {
    const range = e.n === 0 ? "-" : e.lowMin === e.highMin ? `${e.midMin}分` : `${e.lowMin}〜${e.highMin}分`;
    console.log(`${e.size.padEnd(7, "　")} ${String(e.n).padStart(3)}件   ${e.n === 0 ? "-".padStart(6) : `${e.midMin}分`.padStart(6)}      ${range.padEnd(9)}  ${e.confidence}   ${SIZES[e.size]}`);
  }
  process.exit(0);
}
if (!(size in SIZES)) {
  console.error(`知らない大きさです: ${size}(${Object.keys(SIZES).join(" / ")})`);
  process.exit(2);
}
const estimate = estimateFor(rows, size);
if (json) console.log(JSON.stringify(estimate ?? { size, n: 0, lowMin: null, midMin: null, highMin: null, confidence: "不足" }));
else console.log(describeEstimate(estimate));
