import { describe, expect, it } from "vitest";
import { amountDelta, easeOutCubic, formatSignedYen, tweenAmount } from "./amountDelta";

describe("数字が動く: 何円動いたか(UI/UX 調査メモ 第4弾 A-5)", () => {
  it("前に描いた値との差を返す", () => {
    expect(amountDelta({ value: 3480, key: "2026-10-01" }, { value: 4760, key: "2026-10-01" })).toBe(1280);
    expect(amountDelta({ value: 264520 }, { value: 263240 })).toBe(-1280);
  });

  it("開いた直後(前の値が無い・読み込み中)は動かさない — 0 からの数え上げは今までどおり", () => {
    expect(amountDelta(undefined, { value: 4760 })).toBe(0);
    expect(amountDelta({ value: undefined }, { value: 4760 })).toBe(0);
    expect(amountDelta({ value: 4760 }, { value: undefined })).toBe(0);
  });

  it("月・給料日の期間が替わった時は、合計が減っても「−¥…」を浮かべない", () => {
    expect(amountDelta({ value: 98000, key: "2026-10-01" }, { value: 0, key: "2026-11-01" })).toBe(0);
  });

  it("変わっていない・数でない時は 0", () => {
    expect(amountDelta({ value: 1280 }, { value: 1280 })).toBe(0);
    expect(amountDelta({ value: 1280.2 }, { value: 1280.4 })).toBe(0);
    expect(amountDelta({ value: Number.NaN }, { value: 1280 })).toBe(0);
  });
});

describe("浮かべる差額の文字", () => {
  it("足した額は「+¥1,280」、減った額は数学のマイナスで「−¥1,280」", () => {
    expect(formatSignedYen(1280)).toBe("+¥1,280");
    expect(formatSignedYen(-1280)).toBe("−¥1,280");
    expect(formatSignedYen(1234567)).toBe("+¥1,234,567");
    expect(formatSignedYen(99.6)).toBe("+¥100");
  });
});

describe("数え上げの途中の値", () => {
  it("始めは前の値、終わりはちょうど新しい値", () => {
    expect(tweenAmount(3480, 4760, 0)).toBe(3480);
    expect(tweenAmount(3480, 4760, 1)).toBe(4760);
    expect(tweenAmount(3480, 4760, 1.4)).toBe(4760);
  });

  it("途中は整数の円で、前の値と新しい値の間を進む(減る時も)", () => {
    const up = tweenAmount(3480, 4760, 0.5);
    expect(Number.isInteger(up)).toBe(true);
    expect(up).toBeGreaterThan(3480);
    expect(up).toBeLessThan(4760);
    const down = tweenAmount(264520, 263240, 0.5);
    expect(down).toBeLessThan(264520);
    expect(down).toBeGreaterThan(263240);
  });

  it("曲線は最初に速く、最後はゆっくり", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
