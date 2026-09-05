import { test, expect, describe } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMIT_STATE, appStateDir, copyCoworkScripts, hasCommitState } from "./coworkFixture";

// `.cowork/apps/<アプリ名>/` の state.tsv / waiting.txt / pending.md だけをコミットする係。
// 裏（無人）実行から `git -C "<ワークスペース>" add ...` と打つと安全チェックで止まるので、
// cd と git をスクリプトの中に閉じ込めてある（依頼「裏実行で承認が下りない件_原因と対応.md」）。
//
// ここで見たいのは「3つだけを拾い、人の作業途中の変更を巻き込まない」こと。
// 巻き込むと、実装の途中経過が勝手にコミットされるという一番まずい壊れ方をする。

const APP = "テスト案件アプリ";

// core.quotepath=false を付けないと、日本語のパスが \343\203… の形で返ってきて比べられない
const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });

/** 本物と同じ形（ワークスペースが git、アプリは .gitignore で除外、追いかけ先あり）を作る */
function fakeWorkspace() {
  const base = mkdtempSync(join(tmpdir(), "coworkc-"));
  const root = join(base, "ws");
  const remote = join(base, "remote.git");
  mkdirSync(root, { recursive: true });
  copyCoworkScripts(join(root, "scripts"));
  copyFileSync(COMMIT_STATE, join(root, "scripts/cowork-commit-state.sh"));

  git(base, ["init", "--bare", "-q", remote]);
  git(root, ["init", "-q"]);
  writeFileSync(join(root, ".gitignore"), `/${APP}/\n.cowork/apps/*/last_hash\n.cowork/apps/*/report.md\n`);
  writeFileSync(join(root, "README.md"), "seed\n");
  git(root, ["add", ".gitignore", "README.md"]);
  git(root, ["commit", "-qm", "seed"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-q", "-u", "origin", "main"]);

  const state = appStateDir(root, APP);
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "state.tsv"), "abc\tdocs/requests/色を変えたい.md\n");
  writeFileSync(join(state, "waiting.txt"), "保留の理由\n");
  writeFileSync(join(state, "pending.md"), "## 依頼A\n- [ ] 1\n");
  writeFileSync(join(state, "last_hash"), "追跡しない\n");
  writeFileSync(join(state, "report.md"), "追跡しない\n");

  return { root, remote, state };
}

function run(root: string, args: string[]) {
  try {
    const stdout = execFileSync("bash", [join(root, "scripts/cowork-commit-state.sh"), ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "t@example.com" },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe.skipIf(!hasCommitState)(".cowork の状態だけをコミットする", () => {
  test("3つのファイルだけがコミットされ、push まで通る", () => {
    const { root, remote } = fakeWorkspace();

    const r = run(root, [APP]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("push しました");

    const files = git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]).trim().split("\n").sort();
    expect(files).toEqual([
      `.cowork/apps/${APP}/pending.md`,
      `.cowork/apps/${APP}/state.tsv`,
      `.cowork/apps/${APP}/waiting.txt`,
    ]);

    // 追いかけ先にも届いている（端末をまたいで引き継ぐのが目的なので、ここまでで1組）
    expect(git(root, ["rev-list", "--count", "origin/main..HEAD"]).trim()).toBe("0");
    expect(git(remote, ["rev-parse", "main"]).trim()).toBe(git(root, ["rev-parse", "HEAD"]).trim());
  });

  test("人の作業途中の変更も、無関係な staged も巻き込まない", () => {
    const { root } = fakeWorkspace();
    writeFileSync(join(root, "README.md"), "seed\n編集中\n");
    writeFileSync(join(root, "other.txt"), "よそのファイル\n");
    git(root, ["add", "other.txt"]);

    expect(run(root, [APP]).code).toBe(0);

    // README は手つかず（未コミット）、other.txt は staged のまま
    expect(git(root, ["status", "--porcelain", "--", "README.md"])).toContain("M README.md");
    expect(git(root, ["status", "--porcelain", "--", "other.txt"])).toContain("A  other.txt");
    // .gitignore にある印やログは追跡しない
    expect(git(root, ["ls-files", `.cowork/apps/${APP}/`])).not.toContain("last_hash");
  });

  test("変更が無いときは、空のコミットを作らない", () => {
    const { root } = fakeWorkspace();
    run(root, [APP]);
    const before = git(root, ["rev-parse", "HEAD"]).trim();

    const again = run(root, [APP]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("変更はありません");
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(before);
  });

  test("-m でメッセージを、--no-push で push を止められる", () => {
    const { root } = fakeWorkspace();
    run(root, [APP]);
    writeFileSync(join(root, `.cowork/apps/${APP}/pending.md`), "## 依頼A\n- [x] 1\n");

    const r = run(root, [APP, "-m", "やりかけを更新", "--no-push"]);
    expect(r.code).toBe(0);
    expect(git(root, ["log", "-1", "--pretty=%s"]).trim()).toBe("やりかけを更新");
    expect(git(root, ["rev-list", "--count", "origin/main..HEAD"]).trim()).toBe("1");
  });

  test("フォルダ名が分解済み（NFD）でも、合成済み（NFC）の名前で指せる", () => {
    const { root } = fakeWorkspace();
    const nfd = appStateDir(root, APP.normalize("NFD"));
    mkdirSync(nfd, { recursive: true });
    writeFileSync(join(nfd, "state.tsv"), "def\tdocs/requests/別の依頼.md\n");

    // 名前の形が違うだけで「見つからない」と言われては、記録がまるごと落ちる
    expect(run(root, [APP.normalize("NFC")]).code).toBe(0);
  });

  test("知らないアプリ名は、黙って作らずに止まる", () => {
    const { root } = fakeWorkspace();
    const r = run(root, ["ないアプリ"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("見つかりません");
    // 空の状態フォルダを作ってしまうと、次の実行がそれを本物だと思う
    expect(git(root, ["status", "--porcelain"])).not.toContain("ないアプリ");
  });

  test("アプリ名を渡さなければ、何もせずに使い方を出す", () => {
    const { root } = fakeWorkspace();
    const r = run(root, []);
    expect(r.code).toBe(2);
    expect(r.out).toContain("アプリ名を渡してください");
  });

  test("--all は全アプリぶんをまとめて1コミットにする", () => {
    const { root } = fakeWorkspace();
    const other = appStateDir(root, "メール返信AI");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "state.tsv"), "ghi\tdocs/requests/依頼.md\n");

    expect(run(root, ["--all", "--no-push"]).code).toBe(0);
    const files = git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]).trim();
    expect(files).toContain(`.cowork/apps/${APP}/pending.md`);
    expect(files).toContain(".cowork/apps/メール返信AI/state.tsv");
  });
});
