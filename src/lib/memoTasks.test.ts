import { describe, expect, it } from "vitest";
import { MAX_MEMO_TASKS, splitMemoTasks } from "./memoTasks";

describe("メモの本文をタスクの候補にわける", () => {
  it("箇条書きの印を外して、1行ずつの候補にする", () => {
    expect(splitMemoTasks("・見積もりを出す\n- 資料を送る\n1. 日程を決める\n□ 領収書を整理")).toEqual([
      "見積もりを出す",
      "資料を送る",
      "日程を決める",
      "領収書を整理",
    ]);
  });

  it("空行と、同じ行の重なりは除く", () => {
    expect(splitMemoTasks("牛乳を買う\n\n牛乳を買う\n卵を買う\n")).toEqual(["牛乳を買う", "卵を買う"]);
  });

  it("1行しか無い時は候補にしない(今までどおり題名の1件)", () => {
    expect(splitMemoTasks("・見積もりを出す")).toEqual([]);
    expect(splitMemoTasks("")).toEqual([]);
    expect(splitMemoTasks(undefined)).toEqual([]);
  });

  it("多すぎる時は先頭から決まった件数まで、長い行は80字まで", () => {
    const many = Array.from({ length: 30 }, (_, i) => `やること${i + 1}`).join("\n");
    expect(splitMemoTasks(many)).toHaveLength(MAX_MEMO_TASKS);
    expect(splitMemoTasks(`${"あ".repeat(120)}\nb`)[0]).toHaveLength(80);
  });
});
