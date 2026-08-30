import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 常駐(scripts/cowork-daemon.sh)が、依頼を見つけてから見えるウィンドウ側の実行を
// 待ち終えるまでを、偽の Terminal・偽の claude を置いて一通り動かす。
// アプリのコードではなく自動化の仕組みそのものを見ているテスト。
const REPO = process.cwd();

function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), "coworkd-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "docs/requests"), { recursive: true });
  for (const f of ["cowork-daemon.sh", "cowork-run-visible.sh"]) {
    copyFileSync(join(REPO, "scripts", f), join(root, "scripts", f));
  }
  writeFileSync(join(root, "docs/requests/依頼.md"), "# テスト依頼\n");

  const bin = join(root, "bin");
  mkdirSync(bin);
  const write = (name: string, body: string) => {
    const p = join(bin, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  };

  write("claude", ["#!/usr/bin/env bash", 'echo \'{"type":"result","result":"何もありませんでした"}\'', "exit 0", ""].join("\n"));
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
      'mode="${args[$((n-2))]:-}"',
      'note="${args[$((n-1))]:-}"',
      'case "$runner" in',
      "  *cowork-run-visible.sh)",
      '    nohup bash "$runner" "$mode" "$note" >/dev/null 2>&1 &',
      "    exit 0 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  return { root, bin };
}

test("常駐が、見えるウィンドウ側の実行を待って終了コードを受け取る", { timeout: 120_000 }, async () => {
  const { root, bin } = fakeRoot();
  const log = join(root, ".cowork/daemon.log");

  const proc = spawn("bash", [join(root, "scripts/cowork-daemon.sh"), "test"], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      // 待ち時間を詰めて、テストが数秒で終わるようにする
      COWORK_POLL_SEC: "1",
      COWORK_DEBOUNCE_SEC: "1",
      COWORK_COOLDOWN_SEC: "1",
    },
    stdio: "ignore",
    detached: true,
  });

  try {
    const deadline = Date.now() + 60_000;
    let text = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      text = existsSync(log) ? readFileSync(log, "utf8") : "";
      if (text.includes("ヘッドレス実行が終了しました")) break;
    }
    expect(text).toContain("ターミナルのウィンドウで実行中");
    expect(text).toContain("ヘッドレス実行が終了しました（exit=0）");
    // 実行役が実際に走って、読める形の出力を残していること
    expect(readFileSync(join(root, ".cowork/headless-out.txt"), "utf8")).toContain("何もありませんでした");
    // 待ち合わせに使ったファイルは片付いていること
    expect(existsSync(join(root, ".cowork/run.exit"))).toBe(false);
  } finally {
    try {
      process.kill(-proc.pid!, "SIGKILL");
    } catch {
      /* もう死んでいる */
    }
  }
});

test("ウィンドウを開けない環境では、今までどおり無人で走る", { timeout: 120_000 }, async () => {
  const { root, bin } = fakeRoot();
  // GUI が無い状態を作る
  writeFileSync(join(bin, "launchctl"), "#!/usr/bin/env bash\necho 'Background'\n");
  chmodSync(join(bin, "launchctl"), 0o755);
  const log = join(root, ".cowork/daemon.log");

  const proc = spawn("bash", [join(root, "scripts/cowork-daemon.sh"), "test"], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      // 待ち時間を詰めて、テストが数秒で終わるようにする
      COWORK_POLL_SEC: "1",
      COWORK_DEBOUNCE_SEC: "1",
      COWORK_COOLDOWN_SEC: "1",
    },
    stdio: "ignore",
    detached: true,
  });

  try {
    const deadline = Date.now() + 60_000;
    let text = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      text = existsSync(log) ? readFileSync(log, "utf8") : "";
      if (text.includes("ヘッドレス実行が終了しました")) break;
    }
    expect(text).toContain("ヘッドレス実行が終了しました（exit=0）");
    expect(text).not.toContain("ターミナルのウィンドウで実行中");
    expect(readFileSync(join(root, ".cowork/headless-out.txt"), "utf8")).toContain("何もありませんでした");
  } finally {
    try {
      process.kill(-proc.pid!, "SIGKILL");
    } catch {
      /* もう死んでいる */
    }
  }
});
