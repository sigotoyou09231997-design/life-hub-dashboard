import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Cowork の仕組みの実体は、このリポジトリではなく**ワークスペース**（~/Desktop/WEBアプリ用）にある。
// 3本のテストが同じ前提（どこに何があるか）を持つので、ここに集めておく。
export const WORKSPACE = dirname(process.cwd());
export const SCRIPTS = join(WORKSPACE, "scripts");
export const DAEMON = join(SCRIPTS, "cowork-daemon.sh");
export const RUNNER = join(SCRIPTS, "cowork-run-visible.sh");
export const WATCH = join(SCRIPTS, "cowork-watch.sh");

// リポジトリ単体で clone した場合はワークスペースが無いので、その時だけ飛ばす
export const hasWorkspace = existsSync(DAEMON) && existsSync(RUNNER) && existsSync(WATCH);

/** `.cowork/` の状態だけをコミットする係。他の cowork-*.sh と同じ scripts/ にある。 */
export const COMMIT_STATE = join(SCRIPTS, "cowork-commit-state.sh");
export const hasCommitState = existsSync(COMMIT_STATE);

/**
 * 偽のワークスペースの scripts/ に、cowork-*.sh を**まとめて**コピーする。
 *
 * 必要な1本だけコピーする作りにしていたら、スクリプトが共通部品
 * （cowork-time.sh / cowork-paths.sh など）を source するようになった時に、
 * テストだけが古い前提のまま置き去りになって落ちた（2026-08-31）。
 * 何が何を呼ぶかをテスト側で数え上げないよう、丸ごと持っていく。
 */
export function copyCoworkScripts(destScriptsDir: string) {
  mkdirSync(destScriptsDir, { recursive: true });
  for (const name of readdirSync(SCRIPTS)) {
    if (/^cowork-.*\.sh$/.test(name)) copyFileSync(join(SCRIPTS, name), join(destScriptsDir, name));
  }
}

/**
 * アプリ1つぶんの状態の置き場所。
 * 2026-08-31 に <アプリ>/.cowork/ から <ワークスペース>/.cowork/apps/<アプリ名>/ へ移した
 * （scripts/cowork-paths.sh の cowork_app_state_dir と同じ場所を指す）。
 */
export function appStateDir(workspaceRoot: string, app: string) {
  return join(workspaceRoot, ".cowork/apps", app);
}
