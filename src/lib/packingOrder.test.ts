import { describe, expect, it } from "vitest";
import type { TripPackingItem } from "../types";
import { moveTo, renumberPacking, sortPacking } from "./packingOrder";

function item(id: string, overrides: Partial<TripPackingItem> = {}): TripPackingItem {
  return { id, tripId: "t", title: id, category: "essentials", checked: false, createdAt: 0, ...overrides };
}

describe("持ち物の並び順", () => {
  it("並べ替えた持ち物を番号順に、まだのものはそのあとに入れた順で並べる", () => {
    const sorted = sortPacking([
      item("new2", { createdAt: 5 }),
      item("b", { sortOrder: 2 }),
      item("new1", { createdAt: 3 }),
      item("a", { sortOrder: 1 }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["a", "b", "new1", "new2"]);
  });

  it("from 番目を to 番目へ動かす(間はずれる)", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveTo(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
  });

  it("1 から振り直して、番号が変わるものだけ返す", () => {
    const ordered = [item("b", { sortOrder: 2 }), item("a", { sortOrder: 1 }), item("c", { sortOrder: 3 })];
    expect(renumberPacking(ordered)).toEqual([
      { id: "b", sortOrder: 1 },
      { id: "a", sortOrder: 2 },
    ]);
  });
});
