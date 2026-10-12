#!/usr/bin/env node
// 画面の速さ・見た目を、その場で確かめる道具(2026-10-13)。Gmail の「白い」「遅い」を調べた時に、
// 毎回同じ確認の道具を書き直していた(メールを千通入れる・CPU を遅くする・コマ送りで撮る・重い関数を洗い出す)ので、1本にまとめた。
//
//   node scripts/probe.mjs <画面> [指定…]            作業場所(git worktree)の中で。画面は /gmail のような道のり(既定 /)
//
//   --seed gmail=1000        Gmail の連携1件と、メールを1000通入れてから測る(planText 付き。予定候補・支出候補も混ぜる)
//   --cpu 4                  CPU を4倍遅くする(iPhone に近い。既定 4。1で遅くしない)
//   --time                   押してから、はっきり見えるまで・一番長く止まった間を測る(--visits 回、既定 4)
//   --vs /schedule           --time の比べる相手の画面(同じ条件で交互に測る)
//   --marker "<css>"         「見えた」と数える部品(既定: Gmail は最初のメール、ほかは見出し)
//   --film                   押した直後をコマ送りで撮り、1枚に並べる(/tmp/probe/film-*.png。並べるには python3 + PIL)
//   --profile                押した直後の重い関数を、自分の時間・呼び出し先を含む時間で洗い出す
//   --shot                   スマホ幅とPC幅のスクリーンショット(/tmp/probe/shot-*.png。PC幅は --pc-width 1980 --pc-height 1050 で変えられる)
//   --port 5175              開発サーバーの番号(既定 5175。動いていなければ、空の Supabase 設定で自動で立てて、終わったら落とす)
//   --width 390 --height 800 画面の大きさ
//
// 例:  node scripts/probe.mjs /gmail --seed gmail=1000 --time --vs /schedule
//      node scripts/probe.mjs /gmail --seed gmail=400 --film --profile
//
// 開発サーバーは、ログイン無しで開けるよう VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を空にして立てる
// (scripts/lifehub-shots.sh と同じ)。お手本データは Dexie へ直接入れる。**本物のデータには触らない**。
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const route = argv[0] && !argv[0].startsWith("--") ? argv[0] : "/";
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const PORT = Number(opt("port", 5175));
const BASE = `http://localhost:${PORT}`;
const CPU = Number(opt("cpu", 4));
const VISITS = Number(opt("visits", 4));
const VS = opt("vs", "");
const WIDTH = Number(opt("width", 390));
const HEIGHT = Number(opt("height", 800));
const SEED = opt("seed", "");
const OUT = "/tmp/probe";
mkdirSync(OUT, { recursive: true });

async function isUp() {
  try {
    return (await fetch(BASE + "/")).ok;
  } catch {
    return false;
  }
}

/** 動いていなければ開発サーバーを立てる。立てたものだけ、終わりに落とす。 */
async function ensureServer() {
  if (await isUp()) return null;
  const child = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    env: { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    if (await isUp()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`開発サーバーが ${PORT} 番で立ち上がりませんでした`);
}

/** お手本データを Dexie へ入れる。 */
async function seed(page) {
  if (!SEED) return;
  const [kind, countText] = SEED.split("=");
  const count = Number(countText) || 100;
  if (kind !== "gmail") throw new Error(`知らないお手本です: ${kind}(いまは gmail=<通数> だけ)`);
  await page.evaluate(async (count) => {
    const { db } = await import("/src/db/schema.ts");
    await db.syncedEmails.clear();
    await db.gmailAccounts.clear();
    const id = await db.gmailAccounts.add({
      email: "me@example.com",
      accessToken: "x",
      accessTokenExpiresAt: Date.now() + 3600e3,
      refreshToken: "r",
      connectedAt: Date.now() - 1e9,
      lastSyncedAt: Date.now(),
    });
    await db.syncedEmails.bulkAdd(
      Array.from({ length: count }, (_, i) => ({
        accountId: id,
        gmailMessageId: `m${i}`,
        threadId: `t${i}`,
        from: `Sender ${i} <s${i}@example.com>`,
        subject: i % 7 === 0 ? `面接日程のご案内 2026年11月${(i % 28) + 1}日 14:00` : `件名 ${i}`,
        snippet: i % 5 === 0 ? `ご注文の確認 領収書 合計 ¥${i * 100}` : "本文の抜粋 ".repeat(15),
        receivedAt: Date.now() - i * 3600e3,
        status: "unprocessed",
        createdAt: Date.now(),
        planText: (i % 7 === 0 ? "日時は下記のとおりです。2026年11月5日 14:00 場所: 東京 " : "") + "あ".repeat(1500),
      })),
    );
  }, count);
}

const go = (page, path) =>
  page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);

const markerFor = (path) => opt("marker", path.startsWith("/gmail") ? "a[href^='/gmail/mail/']" : ".page-transition h1, .page-transition h2");

/** path を開いて、見えるまで・止まる間を測る。 */
function measure(page, path, marker) {
  return page.evaluate(
    ([path, marker]) =>
      new Promise((resolve) => {
        const eff = (el) => {
          let o = 1;
          for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
          return o;
        };
        const t0 = performance.now();
        let last = t0, worst = 0, busy = 0, first = -1, clear = -1;
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
        const tick = () => {
          const now = performance.now();
          const gap = now - last;
          worst = Math.max(worst, gap);
          if (gap > 50) busy += gap;
          last = now;
          const el = document.querySelector(marker);
          if (el && first < 0) first = Math.round(now - t0);
          if (el && clear < 0 && eff(el) >= 0.95) clear = Math.round(now - t0);
          if (now - t0 < 1500) requestAnimationFrame(tick);
          else resolve({ first, clear, worst: Math.round(worst), busy: Math.round(busy) });
        };
        requestAnimationFrame(tick);
      }),
    [path, marker],
  );
}

async function timeMode(page, cdp) {
  const routes = VS ? [route, VS] : [route];
  const results = new Map(routes.map((r) => [r, []]));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  for (let k = 0; k < VISITS; k++) {
    for (const r of routes) {
      results.get(r).push(await measure(page, r, markerFor(r)));
      await go(page, "/");
      await page.waitForTimeout(1100);
    }
  }
  console.log(`\n== 押してから見えるまで(CPU ${CPU}倍遅く・${VISITS}回。1回目は初回、2回目からは開き直し)`);
  for (const [r, rows] of results) {
    console.log(r);
    rows.forEach((x, i) =>
      console.log(`  ${i + 1}回目  最初に出る ${String(x.first).padStart(4)}ms / はっきり見える ${String(x.clear).padStart(4)}ms / 一番長く止まった間 ${String(x.worst).padStart(4)}ms / 0.05秒以上止まった合計 ${String(x.busy).padStart(4)}ms`),
    );
    const rest = rows.slice(1);
    if (rest.length) {
      const avg = (key) => Math.round(rest.reduce((s, x) => s + x[key], 0) / rest.length);
      console.log(`  開き直しの平均  はっきり見える ${avg("clear")}ms / 止まった間(最長) ${avg("worst")}ms`);
    }
  }
}

async function filmMode(page, cdp) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch { /* 終わり際は無視 */ }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, everyNthFrame: 1 });
  await go(page, route);
  await page.waitForTimeout(1200);
  await cdp.send("Page.stopScreencast");
  cdp.removeAllListeners("Page.screencastFrame");
  const dir = `${OUT}/film`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = frames[0]?.t ?? 0;
  frames.forEach((f, i) => writeFileSync(`${dir}/${String(i).padStart(2, "0")}_${Math.round((f.t - t0) * 1000)}ms.jpg`, Buffer.from(f.data, "base64")));
  console.log(`\n== コマ送り: ${frames.length}コマ → ${dir}/`);
  try {
    const py = `
from PIL import Image, ImageDraw
import glob, os
files = sorted(glob.glob("${dir}/*.jpg"))
n = len(files)
picks = sorted(set(min(i, n - 1) for i in [0, 1, 3, 5, 8, 12, 16, 20, 26, 34, 44, 56]))
ims = [Image.open(files[i]).convert("RGB") for i in picks]
w, h = ims[0].size
s = 0.42
tw, th = int(w * s), int(h * s)
c = Image.new("RGB", (len(ims) * tw, th + 18), "white")
d = ImageDraw.Draw(c)
for i, (im, k) in enumerate(zip(ims, picks)):
    c.paste(im.resize((tw, th)), (i * tw, 18))
    d.text((i * tw + 4, 2), os.path.basename(files[k]).split("_")[1].replace(".jpg", ""), fill="black")
c.save("${OUT}/film.png")
`;
    execFileSync("python3", ["-c", py]);
    console.log(`   1枚に並べた画像: ${OUT}/film.png(Read で開いて見る)`);
  } catch {
    console.log("   (並べる画像は作れませんでした。python3 と PIL が要ります。コマは上のフォルダにあります)");
  }
}

async function profileMode(page, cdp) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await go(page, route);
  await page.waitForTimeout(1500);
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  profile.nodes.forEach((n) => (n.children ?? []).forEach((c) => parent.set(c, n.id)));
  const key = (x) => `${x.callFrame.functionName || "(無名)"} ${x.callFrame.url.split("/").slice(-1)[0].split("?")[0]}:${x.callFrame.lineNumber}`;
  const self = new Map(), total = new Map();
  profile.samples.forEach((id, i) => {
    const d = profile.timeDeltas[i] ?? 0;
    const k = key(byId.get(id));
    self.set(k, (self.get(k) ?? 0) + d);
    const seen = new Set();
    for (let cur = id; cur; cur = parent.get(cur)) {
      const kk = key(byId.get(cur));
      if (!seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) ?? 0) + d); }
    }
  });
  const show = (title, map, filter) => {
    console.log(`\n== ${title}`);
    [...map.entries()].filter(([k]) => filter(k)).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .forEach(([k, v]) => console.log(`${String(Math.round(v / 1000)).padStart(6)}ms  ${k}`));
  };
  show(`自分の時間(CPU ${CPU}倍遅く。(program) はブラウザ内部の描画・配置の計算)`, self, (k) => !/\(idle\)/.test(k));
  show("呼び出し先を含む時間(アプリのコード)", total, (k) => /\.tsx?:/.test(k));
}

async function shotMode(browser) {
  for (const [name, vp] of [["mobile", { width: 390, height: 800 }], ["pc", { width: Number(opt("pc-width", 1440)), height: Number(opt("pc-height", 900)) }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "ja-JP", hasTouch: name === "mobile", isMobile: name === "mobile" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await seed(page);
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/shot-${name}.png` });
    await ctx.close();
  }
  console.log(`\n== スクリーンショット: ${OUT}/shot-mobile.png / ${OUT}/shot-pc.png`);
}

const server = await ensureServer();
const browser = await chromium.launch();
try {
  if (flag("shot")) await shotMode(browser);
  if (flag("time") || flag("film") || flag("profile")) {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, locale: "ja-JP", hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    page.on("pageerror", (e) => console.log("ページのエラー:", String(e).slice(0, 200)));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await seed(page);
    // 起動し直した直後の状態にして、手が空いて先読みが済むまで待つ(アプリの起動後の最初の1回に当たる)
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    if (flag("time")) await timeMode(page, cdp);
    if (flag("film")) await filmMode(page, cdp);
    if (flag("profile")) await profileMode(page, cdp);
    await ctx.close();
  }
  if (!flag("shot") && !flag("time") && !flag("film") && !flag("profile")) {
    console.log("何を測るか指定してください: --time / --film / --profile / --shot(詳しくはこのファイルの先頭)");
  }
} finally {
  await browser.close();
  server?.kill();
}
