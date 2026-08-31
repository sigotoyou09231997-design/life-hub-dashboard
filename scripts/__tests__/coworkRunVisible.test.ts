import { test, expect, describe } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAEMON, RUNNER, appStateDir, hasWorkspace } from "./coworkFixture";

// 実行役（見えるターミナルで claude を走らせる係）もワークスペース側にある。
const APP = "テストアプリ";

// 状態は <ワークスペース>/.cowork/apps/<アプリ名>/ に出るので、
// アプリ単体ではなく「ワークスペースの中のアプリ」の形で作る。
function fakeApp(claudeBody: string) {
  const ws = mkdtempSync(join(tmpdir(), "coworkr-"));
  const app = join(ws, APP);
  mkdirSync(app, { recursive: true });
  const bin = join(ws, "bin");
  mkdirSync(bin);
  const fake = join(bin, "claude");
  writeFileSync(fake, claudeBody);
  chmodSync(fake, 0o755);
  return { ws, app, bin };
}

describe.skipIf(!hasWorkspace)("ワークスペースの Cowork 実行役", () => {
  test("両方のスクリプトが構文エラー無し", () => {
    execFileSync("bash", ["-n", DAEMON]);
    execFileSync("bash", ["-n", RUNNER]);
  });

  test("osascript で組み立てている AppleScript がコンパイルできる", () => {
    const out = join(mkdtempSync(join(tmpdir(), "osa-")), "t.scpt");
    execFileSync("osacompile", [
      "-o", out,
      "-e", "on run argv",
      "-e", "  tell application \"Terminal\"",
      "-e", "    activate",
      "-e", "    do script (\"bash \" & quoted form of (item 1 of argv) & \" \" & quoted form of (item 2 of argv) & \" \" & quoted form of (item 3 of argv))",
      "-e", "  end tell",
      "-e", "end run",
    ]);
    expect(existsSync(out)).toBe(true);
  });

  test("実行役が claude の出力を読める形にして、終了コードを残す", () => {
    const { ws, app, bin } = fakeApp(
      [
        "#!/usr/bin/env bash",
        'echo \'{"type":"assistant","message":{"content":[{"type":"text","text":"依頼を読みます"}]}}\'',
        'echo \'{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{}}]}}\'',
        'echo \'{"type":"result","subtype":"success","result":"1件を反映しました","is_error":false}\'',
        "exit 0",
        "",
      ].join("\n"),
    );

    const out = execFileSync("bash", [RUNNER, app, "acceptEdits"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });

    expect(out).toContain("Cowork");
    expect(out).toContain("依頼を読みます");
    expect(out).toContain("→ Edit");
    expect(out).toContain("1件を反映しました");
    const state = appStateDir(ws, APP);
    expect(readFileSync(join(state, "run.exit"), "utf8").trim()).toBe("0");
    expect(existsSync(join(state, "run.pid"))).toBe(false);
    expect(readFileSync(join(state, "headless-out.txt"), "utf8")).toContain("→ Edit");
  });

  test("claude が失敗したら、その終了コードを残す", () => {
    const { ws, app, bin } = fakeApp("#!/usr/bin/env bash\necho 'boom' >&2\nexit 3\n");

    let code = 0;
    try {
      execFileSync("bash", [RUNNER, app, "acceptEdits"], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(3);
    const state = appStateDir(ws, APP);
    expect(readFileSync(join(state, "run.exit"), "utf8").trim()).toBe("3");
    expect(readFileSync(join(state, "headless-err.txt"), "utf8")).toContain("boom");
  });
});
