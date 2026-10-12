import { describe, expect, it } from "vitest";
import { parseQuickExpense, resolveQuickCategory } from "./quickExpense";
import type { Transaction } from "../types";

describe("parseQuickExpense — 検索欄の文字から、店・品名と金額を読む", () => {
  it("読み取れる: 店と金額(順番はどちらでも・円や¥・カンマ・全角)", () => {
    expect(parseQuickExpense("ランチ 1200")).toEqual({ store: "ランチ", amount: 1200 });
    expect(parseQuickExpense("1200 ランチ")).toEqual({ store: "ランチ", amount: 1200 });
    expect(parseQuickExpense("スーパー ¥3,480")).toEqual({ store: "スーパー", amount: 3480 });
    expect(parseQuickExpense("コンビニ 580円")).toEqual({ store: "コンビニ", amount: 580 });
    expect(parseQuickExpense("ランチ　１２００")).toEqual({ store: "ランチ", amount: 1200 });
    expect(parseQuickExpense("セブン イレブン 640")).toEqual({ store: "セブン イレブン", amount: 640 });
  });

  it("読み取らない: 数字が無い・数字だけ・数字が2つ以上", () => {
    expect(parseQuickExpense("ランチ")).toBeNull();
    expect(parseQuickExpense("1200")).toBeNull();
    expect(parseQuickExpense("ランチ 1200 800")).toBeNull();
    expect(parseQuickExpense("2024 6 ランチ")).toBeNull();
  });

  it("読み取らない: 日付・時刻らしい数字(予定の入力かもしれない)", () => {
    expect(parseQuickExpense("明日19時 歯医者")).toBeNull();
    expect(parseQuickExpense("歯医者 3月5日")).toBeNull();
    expect(parseQuickExpense("会議 10:30")).toBeNull();
    expect(parseQuickExpense("出張 2026/10/13")).toBeNull();
    expect(parseQuickExpense("ランチ 1200 今日")).toBeNull();
    expect(parseQuickExpense("打ち合わせ 午後 1500")).toBeNull();
  });

  it("読み取らない: 数字に文字が付いた語・小数・範囲外の金額(型番や回数を金額にしない)", () => {
    expect(parseQuickExpense("第3回 ランチ")).toBeNull();
    expect(parseQuickExpense("iPhone 15")).toBeNull();
    expect(parseQuickExpense("Windows 11")).toBeNull();
    expect(parseQuickExpense("ランチ 99")).toBeNull();
    expect(parseQuickExpense("ランチ 12.5")).toBeNull();
    expect(parseQuickExpense("ランチ 10000001")).toBeNull();
    expect(parseQuickExpense("ps5 本体")).toBeNull();
  });

  it("100円と1,000万円は、金額として読む(境目)", () => {
    expect(parseQuickExpense("ガム 100")).toEqual({ store: "ガム", amount: 100 });
    expect(parseQuickExpense("車 10000000")).toEqual({ store: "車", amount: 10_000_000 });
  });
});

describe("resolveQuickCategory — 記録するカテゴリの決め方", () => {
  const ordered = ["食費", "日用品", "交通費", "娯楽"];
  const past: Transaction[] = [
    { type: "expense", amount: 500, category: "娯楽", store: "ゲームセンター", memo: "", date: "2026-10-01", isFixed: false, createdAt: 1 },
  ];

  it("①過去に同じ店で選んだカテゴリを使う", () => {
    expect(resolveQuickCategory("ゲームセンター", past, ordered)).toEqual({ category: "娯楽", basis: "history" });
  });

  it("②過去に無ければ、言葉の手がかりを使う", () => {
    expect(resolveQuickCategory("ランチ", [], ordered)).toEqual({ category: "食費", basis: "keyword" });
    expect(resolveQuickCategory("タクシー", [], ordered)).toEqual({ category: "交通費", basis: "keyword" });
  });

  it("③どちらも無ければ、よく使う順の先頭(「その場の決め」だと分かるよう basis を返す)", () => {
    expect(resolveQuickCategory("よく分からない店", [], ordered)).toEqual({ category: "食費", basis: "default" });
    expect(resolveQuickCategory("よく分からない店", [], [])).toEqual({ category: "その他", basis: "default" });
  });
});
