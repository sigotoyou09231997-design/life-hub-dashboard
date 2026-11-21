import { describe, expect, it } from "vitest";
import { buildDiagnosticsText } from "./DiagnosticsCopyButton";

describe("調査用の記録", () => {
  it("版・端末・最後のエラー・動きの記録を、貼り付けられる1つの文章にまとめる", () => {
    const text = buildDiagnosticsText(["11/21 14:00:00 起動", "11/21 14:00:03 裏に回った"], '{"message":"TypeError: x"}', "a601835", "iPhone");
    expect(text).toContain("版 a601835");
    expect(text).toContain("端末: iPhone");
    expect(text).toContain('{"message":"TypeError: x"}');
    expect(text.trim().endsWith("11/21 14:00:03 裏に回った")).toBe(true);
  });
  it("何も残っていなければ「なし」と書く", () => {
    const text = buildDiagnosticsText([], null, "dev", "PC");
    expect(text.match(/\(なし\)/g)).toHaveLength(2);
  });
});
