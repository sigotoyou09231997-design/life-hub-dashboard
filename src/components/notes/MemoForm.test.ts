import { describe, expect, it } from "vitest";
import { memoBodyRows } from "./MemoForm";

describe("メモの本文欄の高さ", () => {
  it("空でも8行ぶんの高さを持つ", () => {
    expect(memoBodyRows("")).toBe(8);
  });

  it("短い本文では最小の高さのまま", () => {
    expect(memoBodyRows("岡山県倉敷市児島味野\n2-2 ポレスター味野公園 1304号室")).toBe(8);
  });

  it("行数が増えたら、その1行下まで伸びる", () => {
    expect(memoBodyRows("あ\n".repeat(9).trimEnd())).toBe(10);
  });

  it("長すぎる本文でも20行で止まる", () => {
    expect(memoBodyRows("あ\n".repeat(100))).toBe(20);
  });
});
