import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();

test("両方のスクリプトが構文エラー無し", () => {
  execFileSync("bash", ["-n", join(REPO, "scripts/cowork-daemon.sh")]);
  execFileSync("bash", ["-n", join(REPO, "scripts/cowork-run-visible.sh")]);
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
  const root = mkdtempSync(join(tmpdir(), "cowork-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(join(REPO, "scripts/cowork-run-visible.sh"), join(root, "scripts/cowork-run-visible.sh"));

  // PATH に置く偽の claude。stream-json を数行だけ吐く。
  const bin = join(root, "bin");
  mkdirSync(bin);
  const fake = join(bin, "claude");
  writeFileSync(
    fake,
    [
      "#!/usr/bin/env bash",
      'echo \'{"type":"assistant","message":{"content":[{"type":"text","text":"依頼を読みます"}]}}\'',
      'echo \'{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{}}]}}\'',
      'echo \'{"type":"result","subtype":"success","result":"1件を反映しました","is_error":false}\'',
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(fake, 0o755);

  const out = execFileSync("bash", [join(root, "scripts/cowork-run-visible.sh"), "acceptEdits", "テスト"], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
  });

  expect(out).toContain("Cowork");
  expect(out).toContain("依頼を読みます");
  expect(out).toContain("→ Edit");
  expect(out).toContain("1件を反映しました");
  expect(readFileSync(join(root, ".cowork/run.exit"), "utf8").trim()).toBe("0");
  expect(existsSync(join(root, ".cowork/run.pid"))).toBe(false);
  expect(readFileSync(join(root, ".cowork/headless-out.txt"), "utf8")).toContain("→ Edit");
});

test("claude が失敗したら、その終了コードを残す", () => {
  const root = mkdtempSync(join(tmpdir(), "cowork-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(join(REPO, "scripts/cowork-run-visible.sh"), join(root, "scripts/cowork-run-visible.sh"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const fake = join(bin, "claude");
  writeFileSync(fake, "#!/usr/bin/env bash\necho 'boom' >&2\nexit 3\n");
  chmodSync(fake, 0o755);

  let code = 0;
  try {
    execFileSync("bash", [join(root, "scripts/cowork-run-visible.sh"), "acceptEdits", "テスト"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (e) {
    code = (e as { status: number }).status;
  }
  expect(code).toBe(3);
  expect(readFileSync(join(root, ".cowork/run.exit"), "utf8").trim()).toBe("3");
  expect(readFileSync(join(root, ".cowork/headless-err.txt"), "utf8")).toContain("boom");
});
