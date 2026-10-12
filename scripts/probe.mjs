#!/usr/bin/env node
// 画面の速さ・見た目を、その場で確かめる道具(2026-10-13)。Gmail の「白い」「遅い」を調べた時に、
// 毎回同じ確認の道具を書き直していた(メールを千通入れる・CPU を遅くする・コマ送りで撮る・重い関数を洗い出す)ので、1本にまとめた。
//
//   node scripts/probe.mjs <画面> [指定…]            作業場所(git worktree)の中で。画面は /gmail のような道のり(既定 /)
//
//   --seed demo              予定・タスク・家計・サブスク・メモ・日記・旅行・就活など、全画面ぶんのお手本データを入れる(scripts/probeDemoSeed.mjs)
//   --seed gmail=1000        Gmail の連携1件と、メールを1000通入れてから測る(planText 付き。予定候補・支出候補も混ぜる)
//   --cpu 4                  CPU を4倍遅くする(iPhone に近い。既定 4。1で遅くしない)
//   --time                   押してから、はっきり見えるまで・一番長く止まった間を測る(--visits 回、既定 4)
//   --vs /schedule           --time の比べる相手の画面(同じ条件で交互に測る)
//   --marker "<css>"         「見えた」と数える部品(既定: Gmail は最初のメール、ほかは見出し)
//   --film                   押した直後をコマ送りで撮り、1枚に並べる(/tmp/probe/film-*.png。並べるには python3 + PIL)
//   --profile                押した直後の重い関数を、自分の時間・呼び出し先を含む時間で洗い出す
//   --contrast               主な7画面(スマホ幅・PC幅)の文字を機械で測り、読みやすさの目安 4.5:1 に届かない文字の数と色の内訳を出す
//   --corners                主な画面(スマホ幅・PC幅)で、丸い角から中身がはみ出している所と、枠から飛び出している所を、実際の描かれた位置から測って出す
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
import { DEMO_TRIP2_ID, DEMO_TRIP_ID, seed as seedDemo } from "./probeDemoSeed.mjs";

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
  if (kind === "demo") {
    await seedDemo(page, { TRIP_ID: DEMO_TRIP_ID, TRIP2_ID: DEMO_TRIP2_ID });
    return;
  }
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


/** 主な画面の文字の読みやすさ(WCAG の 4.5:1)を、実際に描かれた色から測る。第5弾 C-1 で、「薄い文字」が直ったかを数字で確かめるために作った。 */
async function contrastMode(browser) {
  const routes = ["/", "/schedule", "/records/expense", "/records/notes", "/trips", "/settings", "/gmail"];
  let total = 0, failed = 0;
  const kinds = new Map();
  for (const [label, vp] of [["スマホ", { width: 390, height: 800 }], ["PC", { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "ja-JP", hasTouch: label === "スマホ", isMobile: label === "スマホ" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await seed(page);
    for (const r of routes) {
      await page.goto(BASE + r, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      const res = await page.evaluate(() => {
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bgOf = (el) => { let o = { r: 255, g: 255, b: 255 }; const stack = []; for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage !== "none" && /gradient/.test(cs.backgroundImage)) return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; } } for (const c of stack.reverse()) o = { r: c.r * c.a + o.r * (1 - c.a), g: c.g * c.a + o.g * (1 - c.a), b: c.b * c.a + o.b * (1 - c.a) }; return o; };
        const fails = []; let n = 0; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const seen = new Set();
        while (walker.nextNode()) {
          const t = walker.currentNode; if (!t.textContent.trim()) continue;
          const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
          const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
          const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
          const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
          const L1 = lum({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }), L2 = lum(bg);
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); n++;
          const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700; const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
          if (ratio < need) fails.push({ ratio: ratio.toFixed(1), color: cs.color, text: t.textContent.trim().slice(0, 14) });
        }
        return { n, fails };
      });
      total += res.n; failed += res.fails.length;
      res.fails.forEach((f) => kinds.set(`${f.color} ${f.ratio}:1`, (kinds.get(`${f.color} ${f.ratio}:1`) ?? 0) + 1));
    }
    await ctx.close();
  }
  console.log(`\n== 文字の読みやすさ(主な7画面・スマホ幅とPC幅): 文字 ${total} / 4.5:1に届かない ${failed}`);
  console.log("届かない文字の色の内訳(色 読みやすさ: 件数)");
  [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${v}`));
}


/** 角丸の外へ、中身がはみ出していないか(2026-10-13、本人「角丸にしすぎて、ボタンが飛び出たりしてる」)。
 * 丸い角のある箱ごとに、中身の四角の、角にいちばん近い点が、丸い角の円の外にあるかを測る(中身自身の角丸も考慮)。
 * あわせて、中身が箱の枠そのものから出ている所も測る(固定・絶対位置のもの、はみ出しを隠している箱は除く)。 */
async function cornersMode(browser) {
  // 画面と、入力の画面(シート)。?new= は、各画面が受けている「入力を開く」印(?new=event など)。
  const routes = (opt("routes", [
    "/", "/schedule", "/schedule?view=calendar", "/schedule?view=list", "/schedule?new=event", "/schedule?new=task",
    "/records/expense", "/records/expense?tab=history", "/records/expense?tab=summary", "/records/expense?new=expense", "/records/expense?new=salary",
    "/records/notes", "/records/notes?new=note", "/trips", `/trips/${DEMO_TRIP_ID}`, `/trips/${DEMO_TRIP_ID}?tab=route`,
    "/settings", "/gmail", "/review", "/account", "/changelog",
  ].join(","))).split(",");
  const found = new Map();
  for (const [label, vp] of [["スマホ", { width: 390, height: 800 }], ["PC", { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "ja-JP", hasTouch: label === "スマホ", isMobile: label === "スマホ" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await seed(page);
    for (const r of routes) {
      await page.goto(BASE + r, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const res = await page.evaluate(() => {
        const px = (v) => parseFloat(v) || 0;
        const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}`;
        const visibleBox = (cs) => {
          const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
          const a = m ? (m[1].split(/[ ,\/]+/).filter(Boolean).map(Number)[3] ?? 1) : 0;
          return a > 0.08 || (px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") || cs.boxShadow !== "none";
        };
        const out = [];
        const all = [...document.body.querySelectorAll("*")];
        const rectOf = (el) => el.getBoundingClientRect();
        for (const E of all) {
          const cs = getComputedStyle(E);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
          if (cs.overflowX !== "visible" || cs.overflowY !== "visible") continue; // はみ出しを隠している箱は対象外
          const eRect = rectOf(E);
          if (eRect.width < 40 || eRect.height < 30 || !visibleBox(cs)) continue;
          const radii = {
            tl: Math.min(px(cs.borderTopLeftRadius), eRect.width / 2, eRect.height / 2),
            tr: Math.min(px(cs.borderTopRightRadius), eRect.width / 2, eRect.height / 2),
            br: Math.min(px(cs.borderBottomRightRadius), eRect.width / 2, eRect.height / 2),
            bl: Math.min(px(cs.borderBottomLeftRadius), eRect.width / 2, eRect.height / 2),
          };
          for (const D of E.querySelectorAll("*")) {
            const dcs = getComputedStyle(D);
            if (dcs.display === "none" || dcs.visibility === "hidden" || dcs.position === "fixed" || dcs.position === "absolute") continue;
            const dRect = rectOf(D);
            if (dRect.width < 6 || dRect.height < 6) continue;
            const isContent = /^(BUTTON|A|INPUT|TEXTAREA|SELECT|IMG|SVG|LABEL)$/i.test(D.tagName) || visibleBox(dcs) || [...D.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!isContent) continue;
            // (1) 箱の枠から出ている
            const over = Math.max(eRect.left - dRect.left, dRect.right - eRect.right, eRect.top - dRect.top, dRect.bottom - eRect.bottom);
            if (over > 2) { out.push({ kind: "枠から飛び出し", e: name(E), d: name(D), over: Math.round(over), text: (D.textContent || "").trim().slice(0, 14) }); continue; }
            // (2) 丸い角の外へ出ている
            const corners = [
              ["tl", eRect.left, eRect.top, 1, 1, dRect.left, dRect.top, px(dcs.borderTopLeftRadius)],
              ["tr", eRect.right, eRect.top, -1, 1, dRect.right, dRect.top, px(dcs.borderTopRightRadius)],
              ["br", eRect.right, eRect.bottom, -1, -1, dRect.right, dRect.bottom, px(dcs.borderBottomRightRadius)],
              ["bl", eRect.left, eRect.bottom, 1, -1, dRect.left, dRect.bottom, px(dcs.borderBottomLeftRadius)],
            ];
            for (const [c, ex, ey, sx, sy, dx, dy, dr] of corners) {
              const r = radii[c];
              if (r < 10) continue;
              const cx = ex + sx * r, cy = ey + sy * r;
              // 中身の、この角にいちばん近い点(中身自身の角丸の分だけ内側へ)
              const inset = Math.min(dr, dRect.width / 2, dRect.height / 2) * 0.293;
              const pxp = dx - sx * inset * -1, pyp = dy - sy * inset * -1;
              // 角の四角の中にあるか(箱の角から見て、円の手前側)
              const inX = sx > 0 ? pxp < cx : pxp > cx, inY = sy > 0 ? pyp < cy : pyp > cy;
              if (!(inX && inY)) continue;
              const dist = Math.hypot(pxp - cx, pyp - cy);
              if (dist > r + 1) out.push({ kind: "丸い角から飛び出し", e: name(E), d: name(D), over: Math.round(dist - r), radius: Math.round(r), text: (D.textContent || "").trim().slice(0, 14) });
            }
          }
        }
        // (3) 画面の外へ出ている(横にはみ出して、横スクロールの原因になる)。横に隠す・スクロールする入れ物の中は除く。
        for (const el of all) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 6 || rect.height < 6) continue;
          if (rect.right <= window.innerWidth + 1 && rect.left >= -1) continue;
          let clipped = false;
          for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
            const ncs = getComputedStyle(n);
            if (ncs.position === "fixed" || ncs.overflowX !== "visible") { clipped = true; break; }
          }
          if (clipped) continue;
          out.push({ kind: "画面の外へ飛び出し", e: "画面", d: name(el), over: Math.round(Math.max(rect.right - window.innerWidth, -rect.left)), text: (el.textContent || "").trim().slice(0, 14) });
        }
        return out;
      });
      for (const f of res) {
        const key = `${f.kind} | ${f.e} ← ${f.d}`;
        if (!found.has(key)) found.set(key, { over: f.over, radius: f.radius, text: f.text, where: new Set() });
        const x = found.get(key); x.over = Math.max(x.over, f.over); x.where.add(`${label}${r}`);
      }
    }
    await ctx.close();
  }
  console.log(`\n== 角丸・枠からのはみ出し(${found.size}種類)`);
  [...found.entries()].sort((a, b) => b[1].over - a[1].over).slice(0, 40).forEach(([k, v]) =>
    console.log(`${String(v.over).padStart(3)}px  ${k.slice(0, 120)}  「${v.text}」 ${v.radius ? "角丸" + v.radius + "px " : ""}${[...v.where].slice(0, 3).join(",")}`));
}

const server = await ensureServer();
const browser = await chromium.launch();
try {
  if (flag("shot")) await shotMode(browser);
  if (flag("contrast")) await contrastMode(browser);
  if (flag("corners")) await cornersMode(browser);
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
  if (!flag("shot") && !flag("time") && !flag("film") && !flag("profile") && !flag("contrast") && !flag("corners")) {
    console.log("何を測るか指定してください: --time / --film / --profile / --shot / --contrast / --corners(詳しくはこのファイルの先頭)");
  }
} finally {
  await browser.close();
  server?.kill();
}
