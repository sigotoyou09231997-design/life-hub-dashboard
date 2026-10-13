#!/usr/bin/env node
// 画面の動きを、実際のブラウザで確かめる道具(2026-10-14)。修正のたびに、確認用のスクリプトを書き直していた
// (押す場所の指定を間違えて走らせ直す・差し替えの設定を毎回書く)ので、1本にまとめた。
//
//   node scripts/ui-check.mjs <道のり> [指定…] --step "<操作>" --step "<操作>" …
//
//   --seed demo            予定・家計・旅行など全画面ぶんのお手本データを入れてから開く(scripts/probeDemoSeed.mjs)
//   --set <鍵>=<値>        開く前に、localStorage に入れる(何度でも)。例: --set visual.owner=1
//   --stub <元>=<差し替え>  元のファイル(例 src/lib/appFeedback.ts)を、差し替えのファイルに置き換えて開く(何度でも)。
//                          差し替えの側は、元を `import … from "/src/lib/appFeedback.ts?real"` で読めて、サーバーに聞く関数だけ決まった答えにできる
//   --pc / --mobile        画面の大きさ(既定はスマホ 390×800。--width / --height でも)
//   --port 5190            開発サーバーの番号(既定 5190。動いていなければ、空の Supabase 設定で自動で立てて、終わったら落とす)
//   --step "<操作>"        開いたあと、順に行う(書き方は scripts/uiCheckSteps.mjs の先頭)。
//
// 例:  node scripts/ui-check.mjs /trips/demo-trip-1 --seed demo \
//        --step "click:role:button:/昼食.*を編集/" --step "click:role:button:この予定をコピーして追加" \
//        --step "expect:text:予定をコピーして追加" --step "shot:/tmp/probe/copy.png"
//
// 終わりに、操作ごとの ✓/✗ と、画面の中で起きたエラーを出す。✗ かエラーがあれば、終了コードは 1。
// **本物のデータには触らない**(Supabase を空にして立てる。お手本データは端末の中の Dexie にだけ入る)。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { DEMO_TRIP2_ID, DEMO_TRIP_ID, seed as seedDemo } from "./probeDemoSeed.mjs";
import { parseStep, parseStub } from "./uiCheckSteps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const route = argv[0] && !argv[0].startsWith("--") ? argv[0] : "/";
const all = (name) => argv.flatMap((arg, i) => (arg === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const one = (name, fallback) => all(name)[0] ?? fallback;
const flag = (name) => argv.includes(`--${name}`);

const PORT = Number(one("port", 5190));
const BASE = `http://localhost:${PORT}`;
const PC = flag("pc");
const WIDTH = Number(one("width", PC ? 1440 : 390));
const HEIGHT = Number(one("height", PC ? 900 : 800));
const SEED = one("seed", "");
const SETS = all("set").map((pair) => {
  const eq = pair.indexOf("=");
  return [pair.slice(0, eq), pair.slice(eq + 1)];
});
const STUBS = all("stub").map(parseStub);
const STEPS = all("step").map(parseStep);

async function isUp() {
  try {
    return (await fetch(BASE + "/")).ok;
  } catch {
    return false;
  }
}

/** 差し替えがある時だけ、作業場所の中に一時の設定を作る(終わりに消す)。元のファイルを差し替えに置き換える小さなプラグイン。 */
function writeStubConfig() {
  const map = Object.fromEntries(STUBS.map((s) => [resolve(ROOT, s.real), resolve(ROOT, s.stub)]));
  const file = join(ROOT, ".ui-check.vite.config.mjs");
  writeFileSync(
    file,
    `import { mergeConfig } from "vite";
import base from "./vite.config.ts";
const stubs = ${JSON.stringify(map)};
export default mergeConfig(base, {
  plugins: [{
    name: "ui-check-stubs",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.includes("?real")) return null; // 差し替えの側が、元を読む入口
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && stubs[resolved.id] ? stubs[resolved.id] : null;
    },
  }],
});
`,
  );
  return file;
}

async function ensureServer() {
  if (await isUp()) {
    if (STUBS.length > 0) console.log("(動いている開発サーバーを使います。差し替えは効きません。--port を変えてください)");
    return { child: null, cleanup: () => {} };
  }
  const configFile = STUBS.length > 0 ? writeStubConfig() : null;
  const args = ["vite", ...(configFile ? ["--config", configFile] : []), "--port", String(PORT), "--strictPort"];
  const child = spawn("npx", args, { env: { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" }, stdio: "ignore", cwd: ROOT });
  const cleanup = () => {
    child.kill();
    if (configFile && existsSync(configFile)) rmSync(configFile, { force: true });
  };
  for (let i = 0; i < 80; i++) {
    if (await isUp()) return { child, cleanup };
    await new Promise((r) => setTimeout(r, 500));
  }
  cleanup();
  throw new Error(`開発サーバーが ${PORT} 番で立ち上がりませんでした`);
}

function locate(page, target) {
  let loc;
  switch (target.kind) {
    case "role": loc = page.getByRole(target.role, target.name === undefined ? {} : { name: target.name }); break;
    case "text": loc = page.getByText(target.value); break;
    case "placeholder": loc = page.getByPlaceholder(target.value); break;
    case "label": loc = page.getByLabel(target.value); break;
    case "testid": loc = page.getByTestId(target.value); break;
    default: loc = page.locator(target.value);
  }
  const pick = target.pick;
  if (!pick) return loc;
  if (pick.first) return loc.first();
  if (pick.last) return loc.last();
  return loc.nth(pick.nth);
}

async function runStep(page, step) {
  const wait = { timeout: 5000 };
  switch (step.action) {
    case "wait": await page.waitForTimeout(Number(step.arg) || 500); return "";
    case "press": await page.keyboard.press(step.arg); return "";
    case "shot": {
      mkdirSync(dirname(resolve(step.arg)), { recursive: true });
      await page.screenshot({ path: step.arg });
      return step.arg;
    }
  }
  const loc = locate(page, step.target);
  const n = await loc.count();
  if (step.action === "count") return `${n}件`;
  if (step.action === "expect") {
    if (n === 0) throw new Error("見つかりません");
    return `${n}件`;
  }
  if (step.action === "expect-not") {
    if (n > 0) throw new Error(`${n}件あります(無いはずの物)`);
    return "";
  }
  if (n === 0) {
    // 出るまで少し待つ(押した直後に出る物のため)。
    await loc.first().waitFor({ state: "attached", timeout: wait.timeout }).catch(() => {});
    if ((await loc.count()) === 0) throw new Error("見つかりません");
  }
  if ((await loc.count()) > 1 && !step.target.pick) {
    throw new Error(`${await loc.count()}件に当たりました。@first / @last / @nth=N で1つに絞ってください(違う所を押さないため)`);
  }
  switch (step.action) {
    case "click": await loc.click(wait); return "";
    case "fill": await loc.fill(step.value, wait); return "";
    case "scroll": await loc.scrollIntoViewIfNeeded(wait); return "";
    case "expect-text": {
      const text = (await loc.first().innerText(wait)) ?? "";
      if (!text.includes(step.value)) throw new Error(`文字が違います: 「${text.slice(0, 60)}」に「${step.value}」が含まれません`);
      return "";
    }
  }
  return "";
}

const { cleanup } = await ensureServer();
const browser = await chromium.launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, locale: "ja-JP", hasTouch: !PC, isMobile: !PC });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  if (SEED === "demo") await seedDemo(page, { TRIP_ID: DEMO_TRIP_ID, TRIP2_ID: DEMO_TRIP2_ID });
  else if (SEED) throw new Error(`知らないお手本です: ${SEED}(いまは demo だけ。Gmail は scripts/probe.mjs --seed gmail=N)`);
  for (const [key, value] of SETS) await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  console.log(`開きました: ${route}(${WIDTH}×${HEIGHT}${PC ? " PC" : " スマホ"})`);
  for (const step of STEPS) {
    try {
      const note = await runStep(page, step);
      console.log(`  ✓ ${step.text}${note ? `  → ${note}` : ""}`);
    } catch (err) {
      failed = true;
      console.log(`  ✗ ${step.text}  → ${String(err?.message ?? err).split("\n")[0]}`);
      break; // 前の操作が通らないと、あとの操作は意味が無い
    }
  }
  if (errors.length > 0) {
    failed = true;
    console.log(`画面の中でエラーが起きました(${errors.length}件):`);
    for (const e of errors.slice(0, 5)) console.log(`  - ${e}`);
  }
  if (!failed) console.log("全部通りました");
} finally {
  await browser.close();
  cleanup();
}
process.exit(failed ? 1 : 0);
