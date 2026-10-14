import { describe, expect, it } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { parseLocationRemap, planLocationRemap } from "./tripLocationRemap";

function item(id: string, location: string | undefined): TripScheduleItem {
  return { id, tripId: "t1", date: "2026-12-27", title: id, location, type: "sightseeing", createdAt: 1 };
}

function place(id: string, address: string): TripRoutePlace {
  return { id, tripId: "t1", name: id, address, sortOrder: 1, visited: false, createdAt: 1 };
}

describe("parseLocationRemap", () => {
  it("reads 「元 → 新」 lines", () => {
    const { rules, ignored } = parseLocationRemap("霊山寺 → 霊山寺 徳島県鳴門市大麻町\n小金井駅 → 小金井駅 栃木県下野市");
    expect(rules).toEqual([
      { from: "霊山寺", to: "霊山寺 徳島県鳴門市大麻町" },
      { from: "小金井駅", to: "小金井駅 栃木県下野市" },
    ]);
    expect(ignored).toEqual([]);
  });

  it("accepts -> , => and a tab as the separator", () => {
    const { rules } = parseLocationRemap("A -> A県\nB => B県\nC\tC県");
    expect(rules.map((r) => r.to)).toEqual(["A県", "B県", "C県"]);
  });

  it("splits on the first arrow only", () => {
    const { rules } = parseLocationRemap("A → B → C");
    expect(rules).toEqual([{ from: "A", to: "B → C" }]);
  });

  it("skips blank lines and # comments without reporting them", () => {
    const { rules, ignored } = parseLocationRemap("# 四国の旅\n\nA → A県\n   \r\n");
    expect(rules).toHaveLength(1);
    expect(ignored).toEqual([]);
  });

  it("reports lines it cannot use, with the line number", () => {
    const { rules, ignored } = parseLocationRemap(
      ["矢印なし", " → 新だけ", "元だけ → ", "自宅 → (載せない)", "同じ → 同じ", "A → A県", "A → 別のA県"].join("\n"),
    );
    expect(rules).toEqual([{ from: "A", to: "A県" }]);
    expect(ignored.map((l) => [l.line, l.reason])).toEqual([
      [1, "「→」がありません"],
      [2, "元の場所が空です"],
      [3, "新しい場所が空です"],
      [4, "「載せない」は書き換えません"],
      [5, "元と新しい場所が同じです"],
      [7, "同じ元の場所が2回あります(最初の行を使います)"],
    ]);
  });

  it("accepts the full-width form of the 'do not place' mark", () => {
    expect(parseLocationRemap("自宅 → （載せない）").rules).toEqual([]);
  });
});

describe("planLocationRemap", () => {
  const rules = [{ from: "霊山寺", to: "霊山寺 徳島県鳴門市大麻町" }];

  it("finds schedule items and route places whose place is exactly the old one", () => {
    const plan = planLocationRemap(
      rules,
      [item("a", "霊山寺"), item("b", " 霊山寺 "), item("c", "大麻比古神社"), item("d", undefined)],
      [place("r1", "霊山寺"), place("r2", "霊山寺の駐車場")],
    );
    expect(plan.rules[0].scheduleIds).toEqual(["a", "b"]);
    expect(plan.rules[0].routeIds).toEqual(["r1"]);
    expect(plan.scheduleCount).toBe(2);
    expect(plan.routeCount).toBe(1);
  });

  it("does not match part of a longer place name", () => {
    const plan = planLocationRemap(rules, [item("a", "第1番札所 霊山寺")], []);
    expect(plan.scheduleCount).toBe(0);
  });

  it("keeps a rule that matches nothing so the screen can say so", () => {
    const plan = planLocationRemap(rules, [item("a", "別の場所")], []);
    expect(plan.rules).toHaveLength(1);
    expect(plan.rules[0].scheduleIds).toEqual([]);
  });

  it("rewrites each item at most once even when new text equals another old text", () => {
    const plan = planLocationRemap(
      [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      [item("a", "A"), item("b", "B")],
      [],
    );
    expect(plan.rules[0].scheduleIds).toEqual(["a"]);
    expect(plan.rules[1].scheduleIds).toEqual(["b"]);
  });

  it("ignores rows that have no id yet", () => {
    const plan = planLocationRemap(rules, [{ ...item("a", "霊山寺"), id: undefined }], []);
    expect(plan.scheduleCount).toBe(0);
  });
});

describe("planLocationRemap: 移動の目的地(2026-10-14)", () => {
  const rules = [{ from: "霊山寺", to: "霊山寺 徳島県鳴門市大麻町" }];
  const move = (id: string, location: string, endLocation: string) => ({ ...item(id, location), type: "transport" as const, endLocation });

  it("移動の目的地が元の場所とぴったり同じなら、目的地を書き換える対象にする(件数にも入る)", () => {
    const plan = planLocationRemap(rules, [move("m1", "徳島駅", "霊山寺"), item("a", "霊山寺")], []);
    expect(plan.rules[0].scheduleIds).toEqual(["a"]);
    expect(plan.rules[0].endIds).toEqual(["m1"]);
    expect(plan.scheduleCount).toBe(2);
  });

  it("移動でない予定の目的地欄・部分一致は対象にしない", () => {
    const other = { ...item("x", "どこか"), endLocation: "霊山寺" };
    const plan = planLocationRemap(rules, [other, move("m2", "徳島駅", "霊山寺の駐車場")], []);
    expect(plan.rules[0].endIds).toEqual([]);
  });
});
