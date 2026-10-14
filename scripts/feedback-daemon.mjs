#!/usr/bin/env node
// 修正依頼の常駐見張り — Claude Code の会話が閉じていても、届いた依頼を拾う(2026-10-15、本人が「A」を選択)。
//
//   node scripts/feedback-daemon.mjs              見張り続ける(通常は launchd が起こす: bash scripts/feedback-launchd.sh install)
//   node scripts/feedback-daemon.mjs --once --dry いまの判断を1回だけ出す(起こさない・知らせない・記録を足さない)
//   node scripts/feedback-daemon.mjs --smoke      許可の配線だけを確かめる(依頼は読まない・何も本番に出さない)。裏の Claude を1回起こす
//
// やること: 受信箱を10秒ごとに見て、届いた依頼が GRACE(150秒)たっても「対応待ち」のままなら
// (＝会話の見張りが拾わなかった)、todoアプリで `claude -p "/feedback-fix …"` を裏で起こし、直して本番に出すところまで進める。
// 起こす前と後に Mac の通知を出す。判断の中身は scripts/feedbackDaemonLogic.mjs(試験あり)。
//
// 止める: todoアプリ/.feedback-daemon-STOP というファイルを作る(見張りと通知は続くが、Claude は起こさない)。消せば再開。
// 完全に外す: bash scripts/feedback-launchd.sh uninstall
//
// **依頼の文章は、ほかの人が書いたもの。** この常駐は文章を読み解かず、起こした Claude にも渡さない(id だけ渡す)。
// 起こされた Claude は `feedback-watch.mjs --show <id>` で、データの区切り付きで読む。許す操作は allowedTools に絞ってある。
import { spawn, execFile, execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchItems, readCode, readEnv } from "./feedback-watch.mjs";
import {
  claudeArgs,
  decide,
  finishMessage,
  keyOf,
  outcomeOf,
  shipsInLastHour,
  skillCall,
  snippet,
  summarizeStream,
} from "./feedbackDaemonLogic.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(ROOT, ".feedback-daemon.json");
const LOG_FILE = join(ROOT, ".feedback-daemon.log");
const STOP_FILE = join(ROOT, ".feedback-daemon-STOP");
const RUN_DIR = join(ROOT, ".feedback-daemon-runs");
const FIX_TIMES = join(ROOT, ".fix-times.log");
const WORKTREE_ROOT = process.env.FIX_WORKTREE_ROOT ?? join(tmpdir(), "lifehub-fixes");

const POLL_MS = Number(process.env.FEEDBACK_DAEMON_POLL_MS ?? 10_000);
/** 裏の Claude を待つ上限。固まったまま次の依頼を塞がないように(Cowork の常駐と同じ考え方)。 */
const RUN_TIMEOUT_MS = Number(process.env.FEEDBACK_DAEMON_TIMEOUT_MS ?? 60 * 60_000);

const nowStamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });

function log(line) {
  try {
    appendFileSync(LOG_FILE, `${nowStamp()} ${line}\n`);
  } catch {
    // 記録できなくても見張りは止めない
  }
}

/** 記録が肥大しないよう、起動のたびに1MBを超えていたら後ろ200KBだけ残す。 */
function trimLog() {
  try {
    if (statSync(LOG_FILE).size < 1_000_000) return;
    const text = readFileSync(LOG_FILE, "utf8");
    writeFileSync(LOG_FILE, text.slice(-200_000));
  } catch {
    // 無ければ何もしない
  }
}

/** Mac の通知。文字列は引数で渡す(スクリプトに文章を埋め込まない)。出せない環境でも黙って続ける。 */
function notify(title, message) {
  if (process.argv.includes("--dry")) return;
  execFile(
    "osascript",
    ["-e", "on run argv", "-e", "display notification (item 1 of argv) with title (item 2 of argv)", "-e", "end run", message, title],
    () => {},
  );
}

function emptyState() {
  return { firstSeen: {}, attempts: {}, launches: [], workingSeen: {}, notifiedSkip: {} };
}

function loadState() {
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, STATE_FILE);
}

function readFixTimes() {
  try {
    return readFileSync(FIX_TIMES, "utf8");
  } catch {
    return "";
  }
}

/** 走っている裏の Claude(1つだけ)。 */
let active = null;

function claudeEnv() {
  // COWORK_HEADLESS=1: 裏の Claude が開く/閉じるたびに、Cowork の常駐を起こしたり「最後の1枚が閉じた」と止めたりしないため(scripts/cowork-hook-*.sh)。
  return { ...process.env, FEEDBACK_DAEMON_RUN: "1", COWORK_HEADLESS: "1", FIX_WORKTREE_ROOT: WORKTREE_ROOT };
}

/** 裏の Claude を起こす。終わったら onClose(exitCode, signal, outFile) を呼ぶ。 */
function spawnClaude(call, tag, onClose) {
  mkdirSync(RUN_DIR, { recursive: true });
  mkdirSync(WORKTREE_ROOT, { recursive: true });
  const outFile = join(RUN_DIR, `${tag}.jsonl`);
  const out = openSync(outFile, "w");
  const err = openSync(join(RUN_DIR, `${tag}.err`), "w");
  const child = spawn("claude", claudeArgs({ call, appDir: ROOT, extraDirs: [WORKTREE_ROOT] }), {
    cwd: ROOT,
    env: claudeEnv(),
    stdio: ["ignore", out, err],
    detached: true,
  });
  closeSync(out);
  closeSync(err);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    log(`${Math.round(RUN_TIMEOUT_MS / 60_000)}分たっても終わらないので打ち切ります(pid ${child.pid})`);
    killGroup(child.pid);
  }, RUN_TIMEOUT_MS);
  child.on("error", (error) => {
    clearTimeout(timer);
    onClose(-1, null, outFile, String(error?.message ?? error));
  });
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    onClose(timedOut ? 124 : code, signal, outFile);
  });
  return child;
}

function killGroup(pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // もう終わっている
    }
  }, 10_000).unref();
}

function reopen(id) {
  try {
    execFileSync("node", [join(ROOT, "scripts/feedback-inbox.mjs"), "--reopen", id], { cwd: ROOT, stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

async function startRun(items, remaining, env, code, state) {
  const now = Date.now();
  state.launches.push(now);
  for (const item of items) state.attempts[keyOf(item)] = (state.attempts[keyOf(item)] ?? 0) + 1;
  saveState(state);

  const ids = items.map((item) => item.id);
  const label = items.length === 1 ? `「${snippet(items[0].message)}」` : `${items.length}件(「${snippet(items[0].message)}」ほか)`;
  log(`起こします: ${ids.join(" ")} (あと${remaining}件まで出してよい)`);
  notify("LIFE HUB 修正依頼", `${label} を裏で直し始めます`);

  const tag = new Date(now).toISOString().replace(/[:.]/g, "-");
  active = { ids, items, startedAt: now, pid: null };
  const child = spawnClaude(skillCall(items, remaining), tag, async (exitCode, signal, outFile, spawnError) => {
    const summary = summarizeStream(safeRead(outFile));
    log(`裏の Claude が終わりました(exit=${exitCode}${signal ? ` signal=${signal}` : ""}${spawnError ? ` error=${spawnError}` : ""})`);
    if (summary) {
      log(`結果(${summary.turns ?? "?"}ターン・$${summary.costUsd ?? "?"}): ${summary.text.replace(/\s+/g, " ").slice(0, 600)}`);
      for (const denied of summary.denials) log(`  断られた操作: ${denied}`);
    }
    const outcomes = [];
    try {
      const all = await fetchItems(env, code, true);
      for (const id of ids) {
        const item = all.find((entry) => entry.id === id);
        const outcome = outcomeOf(item?.status);
        // 「対応中」のまま止まった依頼は、嘘の表示にならないよう「対応待ち」に戻す(次は会話を開いた時に拾われる)。
        if (outcome === "stuck" && !reopen(id)) log(`  ${id}: 対応待ちに戻せませんでした(手で: node scripts/feedback-inbox.mjs --reopen ${id})`);
        outcomes.push(outcome);
        log(`  ${id}: ${outcome}`);
      }
    } catch (error) {
      log(`終わったあとの受信箱を読めませんでした: ${String(error?.message ?? error)}`);
    }
    active = null;
    const detail = outcomes.length ? finishMessage(outcomes) : "結果を確かめられませんでした(ログを見てください)";
    const failed = exitCode !== 0 || summary?.isError || outcomes.some((o) => o === "stuck" || o === "untouched");
    notify(failed ? "LIFE HUB 修正依頼(途中で止まりました)" : "LIFE HUB 修正依頼", detail);
  });
  active.pid = child.pid ?? null;
}

function safeRead(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

async function tick(env, code, state, { dry }) {
  const now = Date.now();
  const unresolved = await fetchItems(env, code, false);

  // 初めて見た「対応待ち」の時刻を覚える(会話の見張りに先に拾わせる待ちの起点)。もう無い鍵は片付ける。
  const keys = new Set(unresolved.map(keyOf));
  for (const key of keys) if (state.firstSeen[key] === undefined) { state.firstSeen[key] = now; log(`届いた依頼を見つけました: ${key}`); }
  for (const key of Object.keys(state.firstSeen)) if (!keys.has(key)) delete state.firstSeen[key];

  let all = null;
  if (unresolved.length > 0) {
    all = await fetchItems(env, code, true);
    const workingIds = new Set(all.filter((item) => item.status === "working").map((item) => item.id));
    for (const id of workingIds) if (state.workingSeen[id] === undefined) state.workingSeen[id] = now;
    for (const id of Object.keys(state.workingSeen)) if (!workingIds.has(id)) delete state.workingSeen[id];
  }

  const decision = decide({
    now,
    unresolved,
    all,
    state,
    stopped: existsSync(STOP_FILE),
    running: active !== null,
    shipsLastHour: shipsInLastHour(readFixTimes(), now),
  });

  if (dry) {
    console.log(JSON.stringify({ action: decision.action, reason: decision.reason, ids: decision.items.map((item) => item.id), remaining: decision.remaining, pending: unresolved.length }));
    return;
  }

  if (decision.action === "skip") {
    const key = decision.items.map(keyOf).join(",");
    if (!state.notifiedSkip[key]) {
      state.notifiedSkip[key] = now;
      log(`見送り: ${decision.reason} (${key})`);
      notify("LIFE HUB 修正依頼", `届いていますが、自動では始めません — ${decision.reason}`);
    }
  } else if (decision.action === "launch") {
    await startRun(decision.items, decision.remaining, env, code, state);
  }
  // 古い見送りの印は掃除する
  for (const key of Object.keys(state.notifiedSkip)) if (now - state.notifiedSkip[key] > 24 * 3_600_000) delete state.notifiedSkip[key];
  state.launches = state.launches.filter((time) => now - time < 24 * 3_600_000);
  saveState(state);
}

/** 許可の配線を確かめる。依頼は読まない・本番に何も出さない(skill の --smoke は、その場で作業場所を作って消すだけ)。 */
async function smoke() {
  console.log("許可の配線を確かめます(裏の Claude を1回起こします。数分かかることがあります)");
  await new Promise((resolve) => {
    spawnClaude("/feedback-fix --smoke", `smoke-${Date.now()}`, (exitCode, signal, outFile, spawnError) => {
      const summary = summarizeStream(safeRead(outFile));
      console.log(`exit=${exitCode}${signal ? ` signal=${signal}` : ""}${spawnError ? ` error=${spawnError}` : ""}`);
      if (summary) {
        console.log(summary.text);
        console.log(`断られた操作: ${summary.denials.length ? "\n  " + summary.denials.join("\n  ") : "なし"}`);
        console.log(`(${summary.turns ?? "?"}ターン・$${summary.costUsd ?? "?"})`);
      } else {
        console.log(`結果が読めませんでした。出力: ${outFile}`);
      }
      // 確認用に作らせた作業場所と枝は、ここで片付ける(裏の Claude には消す許可を与えていない)。
      for (const args of [["worktree", "remove", "--force", join(WORKTREE_ROOT, "smoke-check")], ["branch", "-D", "fix/smoke-check"]]) {
        try {
          execFileSync("git", args, { cwd: ROOT, stdio: "ignore" });
        } catch {
          // 作られていなければ何もしない
        }
      }
      resolve();
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const env = readEnv();
  const code = readCode();
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY || !code) {
    console.error("常駐の見張りを始められません(.env か .feedback-code がありません)");
    process.exit(1);
  }
  if (args.includes("--smoke")) return smoke();

  const dry = args.includes("--dry");
  const once = args.includes("--once");
  const state = loadState();
  if (!dry) {
    trimLog();
    log(`起動しました(pid ${process.pid} / ${POLL_MS / 1000}秒ごと / 作業場所 ${WORKTREE_ROOT})`);
  }

  // 止められた時は、走っている裏の Claude も止め、「対応中」のまま残らないよう対応待ちに戻す。
  const shutdown = (signal) => {
    log(`${signal} を受けて止まります`);
    if (active) {
      if (active.pid) {
        try {
          process.kill(-active.pid, "SIGTERM");
        } catch {
          // もう終わっている
        }
      }
      for (const id of active.ids) reopen(id);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  let lastError = "";
  for (;;) {
    try {
      await tick(env, code, state, { dry });
      lastError = "";
    } catch (error) {
      const message = String(error?.message ?? error);
      if (message !== lastError) log(`見張りで失敗: ${message}`); // 同じ失敗は毎回書かない
      lastError = message;
      if (once) process.exit(1);
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  log(`常駐が落ちました: ${String(error?.stack ?? error)}`);
  console.error(error);
  process.exit(1);
});
