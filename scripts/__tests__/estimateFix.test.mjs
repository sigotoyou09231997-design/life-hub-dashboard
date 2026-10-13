import { describe, expect, it } from "vitest";
import { SIZES, describeEstimate, estimateAll, estimateFor, parseFixLog, quantile } from "../estimateFix.mjs";

const line = (total, size, extra = {}) =>
  [extra.at ?? "10-14 09:00", extra.sha ?? "abc1234", 60, 50, 30, total, extra.msg ?? "直した", size].join("\t");

describe("parseFixLog", () => {
  it("8列目が大きさ。古い行(7列)は大きさなし。失敗の行・時間が無い行は total を持たない", () => {
    const rows = parseFixLog([line(360, "中"), "10-13 20:00\tdef5678\t-\t-\t-\t300\t古い行", "10-14 09:10\t失敗\t-\t-\t-\t-\t止まった\t中", ""].join("\n"));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ sha: "abc1234", total: 360, size: "中", failed: false });
    expect(rows[1]).toMatchObject({ total: 300, size: null });
    expect(rows[2]).toMatchObject({ failed: true, total: null });
  });
});

describe("quantile", () => {
  it("並べた数の位置の値(間は直線)。空なら null", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([10], 0.5)).toBe(10);
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(quantile([10, 20, 30, 40], 1)).toBe(40);
  });
});

describe("estimateFor", () => {
  it("実績が無い大きさは見積もれない(null)。別の大きさ・失敗・古い行は数えない", () => {
    const rows = parseFixLog([line(300, "小"), "10-13 20:00\tdef5678\t-\t-\t-\t300\t古い行", "10-14 09:10\t失敗\t-\t-\t-\t-\t止まった\t中"].join("\n"));
    expect(estimateFor(rows, "中")).toBeNull();
  });

  it("8件以上は「十分」。4分位の範囲と中央値を分に直す", () => {
    const rows = parseFixLog([240, 270, 300, 330, 360, 390, 420, 600].map((t) => line(t, "中")).join("\n"));
    const e = estimateFor(rows, "中");
    expect(e).toMatchObject({ size: "中", n: 8, confidence: "十分" });
    expect(e.lowMin).toBeLessThanOrEqual(e.midMin);
    expect(e.midMin).toBeLessThanOrEqual(e.highMin);
    expect(e.midMin).toBe(6); // 中央値 345秒 ≒ 6分
  });

  it("4〜7件は「少なめ」、1〜3件は「不足」で最小〜最大を範囲にする", () => {
    const four = estimateFor(parseFixLog([120, 180, 240, 300].map((t) => line(t, "小")).join("\n")), "小");
    expect(four).toMatchObject({ n: 4, confidence: "少なめ" });
    const two = estimateFor(parseFixLog([line(120, "道具"), line(480, "道具")].join("\n")), "道具");
    expect(two).toMatchObject({ n: 2, confidence: "不足", lowMin: 2, highMin: 8 });
  });

  it("1分に満たなくても、1分より短くは言わない", () => {
    const e = estimateFor(parseFixLog(line(20, "出し直し")), "出し直し");
    expect(e).toMatchObject({ lowMin: 1, midMin: 1, highMin: 1 });
  });
});

describe("estimateAll / describeEstimate", () => {
  it("全部の大きさを並べる。実績の無い大きさは n=0 で「不足」", () => {
    const all = estimateAll(parseFixLog(line(360, "中")));
    expect(all.map((e) => e.size)).toEqual(Object.keys(SIZES));
    expect(all.find((e) => e.size === "大")).toMatchObject({ n: 0, midMin: null, confidence: "不足" });
  });

  it("言い方: 範囲があれば範囲と目安、実績が無ければ見積もれないと言う", () => {
    expect(describeEstimate({ n: 5, lowMin: 5, midMin: 6, highMin: 8, confidence: "少なめ" })).toBe("約5〜8分(目安 6分)(実績 5件・データ少なめ)");
    expect(describeEstimate({ n: 2, lowMin: 3, midMin: 3, highMin: 3, confidence: "不足" })).toBe("約3分(実績 2件・データ不足)");
    expect(describeEstimate({ n: 0 })).toContain("見積もれません");
    expect(describeEstimate(null)).toContain("見積もれません");
  });
});
