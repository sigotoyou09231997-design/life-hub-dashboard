import { describe, expect, it } from "vitest";
import { collectStoreSamples, guessCategoryFromStore, normalizeStore } from "./storeCategory";
import type { Transaction } from "../types";

function tx(store: string | undefined, category: string, over: Partial<Transaction> = {}): Transaction {
  return {
    type: "expense",
    amount: 500,
    category,
    store,
    date: "2026-09-04",
    isFixed: false,
    createdAt: 1,
    ...over,
  };
}

describe("normalizeStore", () => {
  it("全角・大文字・空白の違いを吸収する", () => {
    expect(normalizeStore("ＦＡＭＩＬＹ Mart")).toBe("familymart");
    expect(normalizeStore(" セブン イレブン ")).toBe("セブンイレブン");
  });
});

describe("guessCategoryFromStore", () => {
  const samples = collectStoreSamples([
    tx("セブンイレブン渋谷店", "食費", { createdAt: 1 }),
    tx("セブンイレブン渋谷店", "食費", { createdAt: 2 }),
    tx("セブンイレブン渋谷店", "日用品", { createdAt: 3 }),
    tx("マツモトキヨシ", "日用品", { createdAt: 4 }),
    tx(undefined, "交通費", { createdAt: 5 }),
    tx("バイト代", "給与", { type: "income", createdAt: 6 }),
  ]);

  it("収入と店名なしは学習元にしない", () => {
    expect(samples).toHaveLength(4);
  });

  it("同じ店でいちばん多く選んだカテゴリを返す", () => {
    const guess = guessCategoryFromStore(samples, "セブンイレブン渋谷店");
    expect(guess).toMatchObject({ category: "食費", matchedCount: 2, exact: true });
  });

  it("途中まで打った店名からも拾う", () => {
    expect(guessCategoryFromStore(samples, "マツモト")).toMatchObject({
      category: "日用品",
      exact: false,
      matchedStore: "マツモトキヨシ",
    });
  });

  it("1文字では部分一致させない(何にでも当たってしまうため)", () => {
    expect(guessCategoryFromStore(samples, "マ")).toBeNull();
  });

  it("表記ゆれ(空白・全角)があっても同じ店として扱う", () => {
    expect(guessCategoryFromStore(samples, "セブン イレブン 渋谷店")?.category).toBe("食費");
  });

  it("手がかりが無ければ null", () => {
    expect(guessCategoryFromStore(samples, "はじめての店")).toBeNull();
    expect(guessCategoryFromStore(samples, "  ")).toBeNull();
  });

  it("回数が並んだときは、あとに選んだ方を採る", () => {
    const tied = collectStoreSamples([
      tx("カフェ", "娯楽", { createdAt: 1 }),
      tx("カフェ", "交際費", { createdAt: 2 }),
    ]);
    expect(guessCategoryFromStore(tied, "カフェ")?.category).toBe("交際費");
  });
});
