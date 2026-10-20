import { describe, expect, it } from "vitest";
import { dateFromFileName, pairLabelsWithValues, parsePayslipBoxes, type TextBox } from "./payslipLayout";

/** 本物の明細(給与ソフトの表の形)と同じ並び・位置で、中身だけ作り物にしたもの。 */
const b = (str: string, x: number, y: number, w: number): TextBox => ({ str, x, y, w });
const SLIP: TextBox[] = [
  b("給与 明細書", 34, 358, 77),
  b("2026年10月分", 171, 361, 66),
  b("山田 太郎 様", 183, 346, 60),
  // 勤怠(1文字の縦書きの見出しが、数字の行と同じ高さに来る)
  b("勤", 35, 280, 8),
  b("怠", 35, 265, 8),
  b("要勤務日数", 51, 290, 40),
  b("出勤日数", 108, 290, 32),
  b("30.00", 76, 278, 20),
  b("20.00", 129, 278, 20),
  // 支給
  b("支", 35, 211, 8),
  b("給", 35, 171, 8),
  b("基本給", 59, 233, 24),
  b("通勤手当", 423, 233, 32),
  b("200,000", 68, 221, 28),
  b("10,000", 440, 221, 24),
  b("欠勤控除", 108, 162, 32),
  b("課税合計", 423, 162, 32),
  b("総支給額合計", 521, 162, 48),
  b("-5,000", 121, 149, 28),
  b("195,000", 436, 149, 28),
  b("205,000", 541, 149, 28),
  // 控除(「子育て支援金 厚生年金保険」は1つにつながって出てくる)
  b("控", 35, 127, 8),
  b("除", 35, 87, 8),
  b("健康保険料", 51, 137, 40),
  b("子育て支援金 厚生年金保険", 153, 137, 101),
  b("雇用保険料", 314, 137, 40),
  b("社会保険合計", 468, 137, 48),
  b("課税対象額", 525, 137, 40),
  b("10,000", 72, 125, 24),
  b("200", 189, 125, 12),
  b("18,000", 230, 125, 24),
  b("1,000", 339, 125, 20),
  b("29,200", 493, 125, 24),
  b("165,800", 541, 125, 28),
  b("所得税", 59, 113, 24),
  b("住民税", 112, 113, 24),
  b("3,000", 76, 101, 20),
  b("9,000", 129, 101, 20),
  b("控除計", 480, 90, 24),
  b("控除合計", 529, 90, 32),
  b("12,000", 493, 77, 24),
  b("41,200", 545, 77, 24),
  // 記事(差引支給額の行には 0 がいくつも並ぶ)
  b("記", 35, 66, 8),
  b("事", 35, 54, 8),
  b("累積課税合計", 47, 65, 48),
  b("前月調整残", 157, 65, 40),
  b("支払１", 375, 65, 24),
  b("支払２", 427, 65, 24),
  b("差引支給額", 525, 65, 40),
  b("400,000", 68, 53, 28),
  b("0", 197, 53, 4),
  b("163,800", 384, 53, 28),
  b("0", 460, 53, 4),
  b("163,800", 541, 53, 28),
];

describe("見出しと、その下の数字を組にする", () => {
  it("1文字の縦書きの見出しが同じ高さにあっても、行を取り違えない", () => {
    const pairs = Object.fromEntries(pairLabelsWithValues(SLIP).map((pair) => [pair.label, pair.value]));
    expect(pairs["要勤務日数"]).toBe(30);
    expect(pairs["健康保険料"]).toBe(10000);
    expect(pairs["控除合計"]).toBe(41200);
    expect(pairs["差引支給額"]).toBe(163800);
    expect(pairs["前月調整残"]).toBe(0);
  });

  it("つながった見出し(子育て支援金 厚生年金保険)を分けて、それぞれの数字を当てる", () => {
    const pairs = Object.fromEntries(pairLabelsWithValues(SLIP).map((pair) => [pair.label, pair.value]));
    expect(pairs["子育て支援金"]).toBe(200);
    expect(pairs["厚生年金保険"]).toBe(18000);
  });

  it("マイナスの数字(欠勤控除)も読む", () => {
    const pairs = Object.fromEntries(pairLabelsWithValues(SLIP).map((pair) => [pair.label, pair.value]));
    expect(pairs["欠勤控除"]).toBe(-5000);
  });
});

describe("給与明細を読む(parsePayslipBoxes)", () => {
  it("手取り・総支給・控除合計と、控除の欄の内訳(合計・計算のもとは除く)", () => {
    expect(parsePayslipBoxes(SLIP, "1234567_給与明細書_2026_10_20_.pdf")).toEqual({
      slipMonth: "2026-10",
      paidOn: "2026-10-20",
      net: 163800,
      gross: 205000,
      deductionTotal: 41200,
      deductions: [
        { label: "健康保険料", amount: 10000 },
        { label: "子育て支援金", amount: 200 },
        { label: "厚生年金保険", amount: 18000 },
        { label: "雇用保険料", amount: 1000 },
        { label: "所得税", amount: 3000 },
        { label: "住民税", amount: 9000 },
      ],
      balanced: true,
    });
  });

  it("内訳を読み切れなかった時は、控除合計との差を「その他の控除」にする", () => {
    const withoutTax = SLIP.filter((box) => box.str !== "住民税");
    const deductions = parsePayslipBoxes(withoutTax)?.deductions ?? [];
    expect(deductions.find((item) => item.label === "その他の控除")?.amount).toBe(9000);
  });

  it("手取り(差引支給額)が無ければ、この形の明細ではないとして読まない", () => {
    expect(parsePayslipBoxes(SLIP.filter((box) => box.str !== "差引支給額"))).toBeNull();
  });

  it("総支給 − 控除合計 が手取りと合わなければ、合っていないと返す", () => {
    const wrong = SLIP.map((box) => (box.str === "41,200" ? { ...box, str: "41,000" } : box));
    expect(parsePayslipBoxes(wrong)?.balanced).toBe(false);
  });
});

describe("ファイル名の日付", () => {
  it("…_2026_10_20_.pdf や 2026-10-25 から支給日を取り、社員番号などの数字は日付にしない", () => {
    expect(dateFromFileName("1240407_給与明細書_2026_10_20_.pdf")).toBe("2026-10-20");
    expect(dateFromFileName("給与明細 2026-9-25.pdf")).toBe("2026-09-25");
    expect(dateFromFileName("1240407_給与明細書.pdf")).toBeNull();
  });
});
