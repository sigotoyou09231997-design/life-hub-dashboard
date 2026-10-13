#!/usr/bin/env node
// 更新履歴(src/lib/changelog.ts)に1件足す。scripts/ship.sh の --changelog <ファイル> から呼ばれる(2026-10-13)。
//
// なぜ道具にしたか: 修正のたびに、changelog.ts の同じ先頭の場所を手で書き換えていたので、近い時間に2つの修正を作ると
// 必ず衝突した(その解決に約2分)。ship.sh が main を取り込んだあとにこれで足せば、衝突しない。id(日付-連番)も数えてくれる。
//
// 使い方:  node scripts/changelog-add.mjs <ファイル>
//   ファイルは3行(説明は2行目以降が続く):
//     area: ホーム
//     title: 見出し(1行)
//     description: 説明(何行でもよい。最後まで)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "src/lib/changelog.ts");
const input = process.argv[2];
if (!input) {
  console.error("使い方: node scripts/changelog-add.mjs <area/title/description を書いたファイル>");
  process.exit(2);
}

const text = readFileSync(input, "utf8").replace(/\r\n/g, "\n");
const areaMatch = text.match(/^area:\s*(.+)$/m);
const titleMatch = text.match(/^title:\s*(.+)$/m);
const descIndex = text.search(/^description:/m);
if (!areaMatch || !titleMatch || descIndex < 0) {
  console.error("area: / title: / description: の3つが要ります");
  process.exit(2);
}
const area = areaMatch[1].trim();
const title = titleMatch[1].trim();
const description = text.slice(descIndex).replace(/^description:\s*/, "").trim().replace(/\n+/g, "");

const source = readFileSync(target, "utf8");
// すでに同じ題名の履歴があれば、足さない(事前の確認 scripts/preflight.sh --changelog が先に足していても、ship.sh が二重に足さないため)。
if (source.includes(`    title: ${JSON.stringify(title)},\n`)) {
  console.log(`更新履歴にすでにあります: 「${title}」`);
  process.exit(0);
}
const serials = [...source.matchAll(/id:\s*"\d{4}-\d{2}-\d{2}-(\d+)"/g)].map((m) => Number(m[1]));
const next = (serials.length ? Math.max(...serials) : 0) + 1;
const now = new Date(Date.now() + 9 * 3600_000); // 日本時間の日付
const date = now.toISOString().slice(0, 10);
const id = `${date}-${next}`;

const entry =
  `  {\n    id: ${JSON.stringify(id)},\n    date: ${JSON.stringify(date)},\n    area: ${JSON.stringify(area)},\n` +
  `    title: ${JSON.stringify(title)},\n    description:\n      ${JSON.stringify(description)},\n  },\n`;

const marker = "export const CHANGELOG: ChangelogEntry[] = [\n";
const at = source.indexOf(marker);
if (at < 0) {
  console.error("changelog.ts の先頭(CHANGELOG の配列)が見つかりません");
  process.exit(1);
}
writeFileSync(target, source.slice(0, at + marker.length) + entry + source.slice(at + marker.length));
console.log(`更新履歴に足しました: ${id} 「${title}」`);
