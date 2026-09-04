import { describe, expect, it } from "vitest";
import type { Note, ShoppingItem } from "../types";
import { DEFAULT_FREQUENT_ITEMS, frequentShoppingItems } from "./frequentShoppingItems";

function shoppingNote(names: string[], updatedAt: number, id = String(updatedAt)): Note {
  const shoppingItems: ShoppingItem[] = names.map((name, i) => ({
    id: `${id}-${i}`,
    name,
    purchased: false,
  }));
  return {
    id,
    type: "shopping",
    title: "買い出し",
    body: "",
    tags: [],
    pinned: false,
    shoppingItems,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("frequentShoppingItems", () => {
  it("ranks by how often a name was written, then by how recently", () => {
    const notes = [
      shoppingNote(["牛乳", "卵"], 1_000),
      shoppingNote(["牛乳", "パン"], 2_000),
      shoppingNote(["牛乳"], 3_000),
    ];
    const result = frequentShoppingItems(notes, [], 3);
    // 牛乳=3回、卵とパンは1回ずつなので、あとは書いた時刻の新しい順。
    expect(result).toEqual(["牛乳", "パン", "卵"]);
  });

  it("treats spacing and case as the same item, showing the most recent spelling", () => {
    const notes = [shoppingNote([" milk "], 1_000), shoppingNote(["Milk"], 2_000)];
    expect(frequentShoppingItems(notes, [], 1)).toEqual(["Milk"]);
  });

  it("ignores notes that are not shopping lists", () => {
    const memo: Note = {
      id: "memo",
      type: "memo",
      title: "メモ",
      body: "牛乳を買う",
      tags: [],
      pinned: false,
      shoppingItems: [{ id: "x", name: "牛乳", purchased: false }],
      createdAt: 1_000,
    };
    expect(frequentShoppingItems([memo], [], 3)).toEqual(DEFAULT_FREQUENT_ITEMS.slice(0, 3));
  });

  it("leaves out anything already on the list being edited, from history and starters alike", () => {
    const notes = [shoppingNote(["牛乳", "卵"], 1_000)];
    // 牛乳は除外されるので履歴からは卵だけが残り、2枠目は初期候補で埋まる。
    // その初期候補も、除外済み(牛乳)と既出(卵)を飛ばした先頭から採る。
    expect(frequentShoppingItems(notes, [" 牛乳 "], 2)).toEqual(["卵", "パン"]);
  });

  it("falls back to the starter list when there is no history yet", () => {
    expect(frequentShoppingItems([], [], 4)).toEqual(DEFAULT_FREQUENT_ITEMS.slice(0, 4));
  });

  it("never suggests a starter item that history already covers", () => {
    const notes = [shoppingNote(["牛乳"], 1_000)];
    const result = frequentShoppingItems(notes, [], 3);
    expect(result[0]).toBe("牛乳");
    expect(result.filter((n) => n === "牛乳")).toHaveLength(1);
  });
});
