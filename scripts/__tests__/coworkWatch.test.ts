import { test, expect, describe } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appStateDir, copyCoworkScripts, hasWorkspace } from "./coworkFixture";

// 状況を出す係（アプリ別ステータス／依頼ごとの状態）もワークスペース側にある。
// 日本語のフォルダ名・ファイル名で落ちないことを含めて見る。

const APP = "テスト案件アプリ";

function fakeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "coworkw-"));
  copyCoworkScripts(join(root, "scripts"));
  mkdirSync(join(root, APP, "docs/requests"), { recursive: true });
  writeFileSync(join(root, APP, "docs/requests/README.md"), "# 説明（依頼ではない）\n");
  writeFileSync(join(root, APP, "docs/requests/色を変えたい.md"), "# 色を変えたい\n");
  return root;
}

const run = (root: string, args: string[]) =>
  execFileSync("bash", [join(root, "scripts/cowork-watch.sh"), ...args], { encoding: "utf8" });

describe.skipIf(!hasWorkspace)("ワークスペースの Cowork 状況表示", () => {
  test("全アプリ表示でも1アプリ指定でも落ちない（日本語のフォルダ名を含む）", () => {
    const root = fakeWorkspace();

    const all = run(root, []);
    expect(all).toContain("アプリ別ステータス");
    expect(all).toContain(APP);

    const one = run(root, ["--app", APP]);
    expect(one).toContain(`Cowork 検知レポート — ${APP}`);
    // 新しい依頼は着手可として出る。README.md は依頼として数えない
    expect(one).toContain("[NEW]");
    expect(one).toContain("色を変えたい.md");
    expect(one).not.toContain("README.md");
    expect(one).toContain("**着手可**：未処理 1件");
  });

  test("--update を付けたあとは実装済みになり、差分が消える", () => {
    const root = fakeWorkspace();
    run(root, ["--app", APP, "--update"]);

    const after = run(root, ["--app", APP]);
    expect(after).toContain("変更なし");
    expect(after).toContain("実装済み");
    expect(after).toContain("実装済み（新規依頼待ち）");
    // 記録は sha1 + パスの表になっている
    const state = readFileSync(join(appStateDir(root, APP), "state.tsv"), "utf8");
    expect(state).toMatch(/^[0-9a-f]{40}\tdocs\/requests\/色を変えたい\.md$/m);
  });

  test("依頼が更新されたら、また着手可に戻る", () => {
    const root = fakeWorkspace();
    run(root, ["--app", APP, "--update"]);
    writeFileSync(join(root, APP, "docs/requests/色を変えたい.md"), "# 色を変えたい\n\n赤にしてほしい。\n");

    const after = run(root, ["--app", APP]);
    expect(after).toContain("[MOD]");
    expect(after).toContain("着手可（更新）");
  });
});
