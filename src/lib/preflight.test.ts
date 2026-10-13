// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 事前の確認(scripts/preflight.sh と ship-lib.sh の preflight_reuse)。
 * 守ること(精度を下げない): 同じ内容(コミットの木が同じ)の通った確認だけを使う / 内容が変わったら使わない /
 * 走っている途中で内容が変わったら、通っても結果を残さない / 落ちたら使わない / 30分で古くなる / 更新履歴を二重に足さない。
 * 重い本物の全テストは走らせず、SHIP_CHECKS_STUB で、確認の代わりの命令に差し替える。
 */
const SCRIPTS = fileURLToPath(new URL("../../scripts/", import.meta.url));
const LIB = join(SCRIPTS, "ship-lib.sh");
const PREFLIGHT = join(SCRIPTS, "preflight.sh");

function sh(cwd: string, command: string, env: Record<string, string> = {}): string {
  return execFileSync("bash", ["-c", command], { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

/** 作業ブランチつきの、小さな git の置き場を作る。 */
function makeRepo(): { dir: string; state: string } {
  const dir = mkdtempSync(join(tmpdir(), "preflight-repo-"));
  const state = mkdtempSync(join(tmpdir(), "preflight-state-"));
  sh(dir, "git init -q -b main && git config user.email t@example.com && git config user.name t && git config commit.gpgsign false");
  mkdirSync(join(dir, "src/lib"), { recursive: true });
  writeFileSync(join(dir, "a.txt"), "1\n");
  writeFileSync(join(dir, "src/lib/changelog.ts"), 'export const CHANGELOG: ChangelogEntry[] = [\n  {\n    id: "2026-10-13-1",\n    title: "古い",\n  },\n];\n');
  sh(dir, "git add -A && git commit -q -m base && git checkout -q -b fix/x");
  writeFileSync(join(dir, "a.txt"), "2\n");
  sh(dir, "git add -A && git commit -q -m change");
  return { dir, state };
}

function env(state: string, stub: string): Record<string, string> {
  return { SHIP_PREFLIGHT_DIR: state, SHIP_CHECKS_STUB: stub };
}

function reuse(dir: string, state: string): boolean {
  const result = spawnSync("bash", ["-c", `source "${LIB}"; preflight_reuse "$(git rev-parse 'HEAD^{tree}')"`], {
    cwd: dir,
    env: { ...process.env, SHIP_PREFLIGHT_DIR: state },
    encoding: "utf8",
  });
  return result.status === 0;
}

describe("事前の確認: 結果を使う条件", () => {
  it("同じ内容の確認が通っていれば、使う", () => {
    const { dir, state } = makeRepo();
    sh(dir, `bash "${PREFLIGHT}" --wait`, env(state, "true"));
    expect(reuse(dir, state)).toBe(true);
  });

  it("確認をしていない内容には、使わない", () => {
    const { dir, state } = makeRepo();
    expect(reuse(dir, state)).toBe(false);
  });

  it("確認のあとに内容を1文字でも変えたら(コミットが進んだら)、前の結果は使わない", () => {
    const { dir, state } = makeRepo();
    sh(dir, `bash "${PREFLIGHT}" --wait`, env(state, "true"));
    writeFileSync(join(dir, "a.txt"), "3\n");
    sh(dir, "git add -A && git commit -q -m more");
    expect(reuse(dir, state)).toBe(false);
  });

  it("確認が落ちたら、使わない(落ちた印だけが残る)", () => {
    const { dir, state } = makeRepo();
    const result = spawnSync("bash", [PREFLIGHT, "--wait"], { cwd: dir, env: { ...process.env, ...env(state, "false") }, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(reuse(dir, state)).toBe(false);
    expect(sh(dir, `bash "${PREFLIGHT}" --status`, env(state, "false"))).toContain("落ちた");
  });

  it("走っているあいだに内容が変わった(コミットしていない変更ができた)時は、通っても結果を残さない", () => {
    const { dir, state } = makeRepo();
    // 確認の代わりの命令が、走っている最中に、作業ファイルを書き換える
    const result = spawnSync("bash", [PREFLIGHT, "--wait"], {
      cwd: dir,
      env: { ...process.env, ...env(state, "bash -c 'echo changed > a.txt'") },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(reuse(dir, state)).toBe(false);
  });

  it("コミットしていない変更がある時は、始めない(確かめる内容が決まらないため)", () => {
    const { dir, state } = makeRepo();
    writeFileSync(join(dir, "a.txt"), "未コミット\n");
    const result = spawnSync("bash", [PREFLIGHT], { cwd: dir, env: { ...process.env, ...env(state, "true") }, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("コミットされていない変更");
  });

  it("通った結果は30分で古くなり、使わない", () => {
    const { dir, state } = makeRepo();
    sh(dir, `bash "${PREFLIGHT}" --wait`, env(state, "true"));
    const tree = sh(dir, "git rev-parse 'HEAD^{tree}'");
    const old = new Date(Date.now() - 31 * 60_000);
    utimesSync(join(state, `${tree}.ok`), old, old);
    expect(reuse(dir, state)).toBe(false);
  });

  it("走っている最中の確認があれば、終わるのを待って、その結果を使う", () => {
    const { dir, state } = makeRepo();
    // 裏で始める(確認の代わりの命令は、少し待ってから通る)。すぐ ship 側の見方で待つ。
    sh(dir, `bash "${PREFLIGHT}"`, env(state, "sleep 1"));
    const started = Date.now();
    expect(reuse(dir, state)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
  });

  it("main に追いついていないブランチは、ship.sh と同じく main を取り込んでから確かめる(同じ内容を確かめる)", () => {
    const { dir, state } = makeRepo();
    sh(dir, "git checkout -q main && echo m > m.txt && git add -A && git commit -q -m mainmove && git checkout -q fix/x");
    sh(dir, `bash "${PREFLIGHT}" --wait`, env(state, "true"));
    expect(existsSync(join(dir, "m.txt"))).toBe(true);
    expect(reuse(dir, state)).toBe(true);
  });
});

describe("事前の確認: 更新履歴", () => {
  const entry = "area: 旅行\ntitle: 新しい題名\ndescription: 説明\n";

  it("--changelog で先に足してコミットする。そのあとの ship.sh の道具は、二重に足さない", () => {
    const { dir, state } = makeRepo();
    const file = join(dir, "cl.txt");
    writeFileSync(file, entry);
    // changelog-add.mjs は、作業場所の scripts にある。試験の置き場へ写す。
    sh(dir, `mkdir -p scripts && cp "${join(SCRIPTS, "changelog-add.mjs")}" scripts/ && git add -A && git commit -q -m tools`);
    sh(dir, `bash "${PREFLIGHT}" --changelog "${file}" --message "x" --wait`, env(state, "true"));
    const once = readFileSync(join(dir, "src/lib/changelog.ts"), "utf8");
    expect(once.match(/新しい題名/g)).toHaveLength(1);
    expect(sh(dir, "git status --porcelain --untracked-files=no")).toBe("");
    // ship.sh がもう一度同じ道具を呼んでも、足さない
    const second = sh(dir, `node scripts/changelog-add.mjs "${file}"`);
    expect(second).toContain("すでにあります");
    expect(readFileSync(join(dir, "src/lib/changelog.ts"), "utf8")).toBe(once);
    // 先に足した内容の確認が、そのまま使える
    expect(reuse(dir, state)).toBe(true);
  });
});
