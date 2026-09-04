import { test, expect, describe } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appStateDir, copyCoworkScripts, hasWorkspace } from "./coworkFixture";

// Cowork の常駐は、このリポジトリではなく**ワークスペース**（~/Desktop/WEBアプリ用）に1つだけ置いてある。
// 中の全アプリを1つの常駐が見張る作りなので、スクリプトの実体も向こうにある。
// ここでは偽の Terminal・偽の claude を置いて、検知から実行の待ち合わせまでを一通り動かす。
// アプリのコードではなく自動化の仕組みそのものを見ているテスト。
const APP = "テストアプリ";

function fakeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "coworkd-"));
  copyCoworkScripts(join(root, "scripts"));
  mkdirSync(join(root, APP, "docs/requests"), { recursive: true });
  writeFileSync(join(root, APP, "docs/requests/依頼.md"), "# テスト依頼\n");

  const bin = join(root, "bin");
  mkdirSync(bin);
  const write = (name: string, body: string) => {
    const p = join(bin, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  };

  // 渡された引数を残す。--add-dir が抜けると、実装はできても状態ファイル
  // (.cowork/apps/<アプリ>/) に書けず「実装済みの記録が残らない」が起きるため。
  write(
    "claude",
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" > ${JSON.stringify(join(root, "claude-args.txt"))}`,
      'echo \'{"type":"result","result":"何もありませんでした"}\'',
      "exit 0",
      "",
    ].join("\n"),
  );
  write("launchctl", ["#!/usr/bin/env bash", 'echo "Aqua"', ""].join("\n"));
  // Terminal.app の代わり。do script と同じく「開いて即戻る」ようにする。
  // 通知(display notification)で呼ばれた時は何もしない。
  write(
    "osascript",
    [
      "#!/usr/bin/env bash",
      'args=("$@")',
      "n=${#args[@]}",
      'runner="${args[$((n-3))]:-}"',
      'a2="${args[$((n-2))]:-}"',
      'a3="${args[$((n-1))]:-}"',
      'case "$runner" in',
      "  *cowork-run-visible.sh)",
      '    nohup bash "$runner" "$a2" "$a3" >/dev/null 2>&1 &',
      "    exit 0 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  return { root, bin };
}

// 既定は「ターミナルを出さずに裏で走らせる」。見えるウィンドウ側を見たいテストだけ visible: true にする。
function startDaemon(root: string, bin: string, visible = false) {
  return spawn("bash", [join(root, "scripts/cowork-daemon.sh"), "test"], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      COWORK_VISIBLE_RUN: visible ? "1" : "0",
      // 待ち時間を詰めて、テストが数秒で終わるようにする
      COWORK_POLL_SEC: "1",
      COWORK_DEBOUNCE_SEC: "1",
      COWORK_COOLDOWN_SEC: "1",
    },
    stdio: "ignore",
    detached: true,
  });
}

async function waitForLog(log: string, needle: string, ms = 60_000) {
  const deadline = Date.now() + ms;
  let text = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    text = existsSync(log) ? readFileSync(log, "utf8") : "";
    if (text.includes(needle)) break;
  }
  return text;
}

describe.skipIf(!hasWorkspace)("ワークスペースの Cowork 常駐", () => {
  test("見えるウィンドウを出す設定のときは、その実行を待って終了コードを受け取る", { timeout: 120_000 }, async () => {
    const { root, bin } = fakeWorkspace();
    const proc = startDaemon(root, bin, true);

    try {
      const text = await waitForLog(join(root, ".cowork/daemon.log"), "実行が終了しました");
      expect(text).toContain("ターミナルのウィンドウで実行中");
      expect(text).toContain("実行が終了しました（exit=0）");
      // 実行役が実際に走って、読める形の出力を残していること
      const state = appStateDir(root, APP);
      expect(readFileSync(join(state, "headless-out.txt"), "utf8")).toContain("何もありませんでした");
      // 待ち合わせに使ったファイルは片付いていること
      expect(existsSync(join(state, "run.exit"))).toBe(false);
      // 処理済みの印が残っていること（次の起動で同じ依頼を繰り返さないため）
      expect(existsSync(join(state, "last_hash"))).toBe(true);
    } finally {
      try {
        process.kill(-proc.pid!, "SIGKILL");
      } catch {
        /* もう死んでいる */
      }
    }
  });

  test("既定ではターミナルを出さずに裏で走る", { timeout: 120_000 }, async () => {
    const { root, bin } = fakeWorkspace();
    const proc = startDaemon(root, bin);

    try {
      const text = await waitForLog(join(root, ".cowork/daemon.log"), "実行が終了しました");
      expect(text).toContain("実行が終了しました（exit=0）");
      expect(text).not.toContain("ターミナルのウィンドウで実行中");
      expect(readFileSync(join(appStateDir(root, APP), "headless-out.txt"), "utf8")).toContain("何もありませんでした");
      // 状態フォルダを書き込み先として許可して起動していること。
      // これが抜けていた頃は、実装は終わるのに state.tsv / pending.md が更新されず、
      // 次の実行が同じ依頼をやり直していた。
      const args = readFileSync(join(root, "claude-args.txt"), "utf8").split("\n");
      expect(args).toContain("--add-dir");
      expect(args).toContain(appStateDir(root, APP));
    } finally {
      try {
        process.kill(-proc.pid!, "SIGKILL");
      } catch {
        /* もう死んでいる */
      }
    }
  });

  test("常駐が止まっている間に置かれた依頼を、起動時に拾い直す", { timeout: 120_000 }, async () => {
    const { root, bin } = fakeWorkspace();
    // 「前回ここまで処理し切った」印を、いまの内容に合わせて作っておく
    mkdirSync(appStateDir(root, APP), { recursive: true });
    const proc1 = startDaemon(root, bin);
    await waitForLog(join(root, ".cowork/daemon.log"), "実行が終了しました");
    try {
      process.kill(-proc1.pid!, "SIGKILL");
    } catch {
      /* もう死んでいる */
    }
    await new Promise((r) => setTimeout(r, 500));

    // 常駐が居ない間に依頼が増える
    writeFileSync(join(root, APP, "docs/requests/あとから来た依頼.md"), "# あとから\n");
    writeFileSync(join(root, ".cowork/daemon.log"), "");

    const proc2 = startDaemon(root, bin);
    try {
      const text = await waitForLog(join(root, ".cowork/daemon.log"), "実行が終了しました");
      expect(text).toContain("起動時点で未処理の書き込みが残っている");
      expect(text).toContain("実行が終了しました（exit=0）");
    } finally {
      try {
        process.kill(-proc2.pid!, "SIGKILL");
      } catch {
        /* もう死んでいる */
      }
    }
  });
});
