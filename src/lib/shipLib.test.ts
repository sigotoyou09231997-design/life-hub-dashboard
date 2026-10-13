// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * scripts/ship-lib.sh の finish_feedback: 要望を「対応済み」にするのは、本番(Vercel)で新しい版を確かめた時だけ
 * (2026-10-14、本人「対応済みに変わってるけど、本番に反映されてる状態が対応済みであってほしい」)。
 * 呼ぶ道具は FEEDBACK_INBOX_CMD で、呼ばれた引数をそのまま出すものに差し替える。
 */
const LIB = fileURLToPath(new URL("../../scripts/ship-lib.sh", import.meta.url));

function run(live: number, id: string): string {
  return execFileSync("bash", ["-c", `source "${LIB}"; finish_feedback ${live} "${id}" /tmp/main`], {
    env: { ...process.env, FEEDBACK_INBOX_CMD: "echo 道具が呼ばれた:" },
    encoding: "utf8",
  }).trim();
}

describe("ship.sh: 要望を対応済みにする条件", () => {
  it("本番で新しい版を確かめた時は、対応済みにする(--done を付けて道具を呼ぶ)", () => {
    expect(run(1, "abc-123")).toBe("道具が呼ばれた: --done abc-123");
  });

  it("確かめられなかった時は、道具を呼ばない(対応中のまま)。本人に、あとでどうすればいいかを伝える", () => {
    const out = run(0, "abc-123");
    expect(out).not.toContain("道具が呼ばれた");
    expect(out).toContain("「対応中」のままにしました");
    expect(out).toContain("--done abc-123");
  });

  it("要望の id が無い(要望ではない修正)時は、何もしない", () => {
    expect(run(1, "")).toBe("");
    expect(run(0, "")).toBe("");
  });
});
