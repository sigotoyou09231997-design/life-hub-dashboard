import { describe, expect, it } from "vitest";
import { parseCsvRows, buildPreview } from "./csv";

describe("buildPreview", () => {
  const rows = parseCsvRows(["日付,内容,金額,店舗", "2026/07/01,ランチ,-1200,カフェA", "2026/07/02,給与振込,300000,会社", "2026/07/03,返金,500,カフェA"].join("\n"));

  it("separates the header row from data rows when hasHeaderRow is true", () => {
    const preview = buildPreview(rows, true);
    expect(preview.header).toEqual(["日付", "内容", "金額", "店舗"]);
    expect(preview.totalDataRows).toBe(3);
  });

  it("treats every row as data when hasHeaderRow is false", () => {
    const preview = buildPreview(rows, false);
    expect(preview.header).toBeNull();
    expect(preview.totalDataRows).toBe(4);
  });

  it("caps sampleRows at the requested size", () => {
    const preview = buildPreview(rows, true, 2);
    expect(preview.sampleRows).toHaveLength(2);
  });
});
