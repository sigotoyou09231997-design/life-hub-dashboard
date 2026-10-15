/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";

vi.mock("../db/schema", () => ({ db: {} }));

import { placesToRemoveFor, readExcludedIds, reflectCovers, reflectRows, setExcludedId } from "./tripRouteReflect";
import { toRouteSuggestions } from "./tripRouteSuggestions";

function item(over: Partial<TripScheduleItem> & { id: string; date: string; title: string }): TripScheduleItem {
  return { tripId: "t1", type: "sightseeing", createdAt: 1, ...over };
}

function place(address: string, over: Partial<TripRoutePlace> = {}): TripRoutePlace {
  return { id: `p-${address}`, tripId: "t1", name: address, address, sortOrder: 1, date: "2026-09-19", visited: false, createdAt: 1, ...over };
}

beforeEach(() => window.localStorage.clear());

describe("「入れない」の印を覚える", () => {
  it("旅行ごとに、この端末に覚える。戻せる。同じ予定を二度足しても1つ", () => {
    expect(readExcludedIds("t1")).toEqual([]);
    expect(setExcludedId("t1", "s1", true)).toEqual(["s1"]);
    expect(setExcludedId("t1", "s1", true)).toEqual(["s1"]);
    expect(setExcludedId("t1", "s2", true)).toEqual(["s1", "s2"]);
    expect(readExcludedIds("t1")).toEqual(["s1", "s2"]);
    expect(readExcludedIds("t2")).toEqual([]);
    expect(setExcludedId("t1", "s1", false)).toEqual(["s2"]);
  });

  it("壊れた記録・覚えられない環境でも落ちない", () => {
    window.localStorage.setItem("lifeHubRouteExcluded:t1", "ばらばら{");
    expect(readExcludedIds("t1")).toEqual([]);
    window.localStorage.setItem("lifeHubRouteExcluded:t1", JSON.stringify(["a", 1, null]));
    expect(readExcludedIds("t1")).toEqual(["a"]);
  });
});

describe("reflectRows(予定ごとのルートとの関係)", () => {
  const schedule = [
    item({ id: "in", date: "2026-09-19", startTime: "09:00", title: "鶴岡八幡宮", location: "鶴岡八幡宮" }),
    item({ id: "out", date: "2026-09-19", startTime: "11:00", title: "江ノ島", location: "江ノ島" }),
    item({ id: "off", date: "2026-09-19", startTime: "13:00", title: "お土産", location: "小町通り" }),
    item({ id: "title", date: "2026-09-19", startTime: "15:00", title: "長谷寺" }),
    item({ id: "bus", date: "2026-09-19", startTime: "16:00", title: "バスで移動", type: "transport" }),
  ];

  it("入っている/まだ/入れない/選べない を見分ける。日付と時刻の順", () => {
    const rows = reflectRows(schedule, [place("鶴岡八幡宮")], ["off"]);
    expect(rows.map((row) => [row.item.id, row.state])).toEqual([
      ["in", "in"],
      ["out", "out"],
      ["off", "off"],
      ["title", "out"],
      ["bus", "none"],
    ]);
  });

  it("予定の名前だけで作った場所は、名前が同じなら入っているとみなす。場所の入った予定は、住所で見る(名前が同じでも住所が違えば入っていない)", () => {
    const named = place("長谷寺", { name: "長谷寺" });
    expect(reflectRows(schedule, [named], []).find((row) => row.item.id === "title")?.state).toBe("in");
    const rows = reflectRows(schedule, [place("神奈川県鎌倉市…", { name: "江ノ島" })], []);
    expect(rows.find((row) => row.item.id === "out")?.state).toBe("out");
  });

  it("入っている予定が「入れない」の印を持っていても、ルートに入っている間は「入っている」と見せる(嘘を言わない)", () => {
    const rows = reflectRows(schedule, [place("鶴岡八幡宮")], ["in"]);
    expect(rows.find((row) => row.item.id === "in")?.state).toBe("in");
  });

  it("移動は、出発地・目的地のどちらかが入っていれば入っている。どちらも無ければ選べない", () => {
    const train = item({ id: "tr", date: "2026-09-19", title: "新幹線", type: "transport", location: "岡山駅", endLocation: "新横浜駅" });
    expect(reflectRows([train], [place("新横浜駅")], [])[0].state).toBe("in");
    expect(reflectRows([train], [], [])[0].state).toBe("out");
    expect(reflectRows([item({ id: "x", date: "2026-09-19", title: "新幹線", type: "transport" })], [], [])[0].state).toBe("none");
  });

  it("id の無い予定・名前の空の予定は出さない/選べない", () => {
    expect(reflectRows([{ ...item({ id: "a", date: "2026-09-19", title: "x" }), id: undefined }], [], [])).toEqual([]);
    expect(reflectRows([item({ id: "b", date: "2026-09-19", title: "  " })], [], [])[0].state).toBe("none");
  });
});

describe("「入れない」の予定は、候補に出さない", () => {
  it("excluded に入れた予定は、場所のある予定も名前だけの予定も、候補から外れる", () => {
    const schedule = [
      item({ id: "a", date: "2026-09-19", title: "鶴岡八幡宮", location: "鶴岡八幡宮" }),
      item({ id: "b", date: "2026-09-19", title: "長谷寺" }),
      item({ id: "c", date: "2026-09-19", title: "江ノ島", location: "江ノ島" }),
    ];
    expect(toRouteSuggestions(schedule, [], { titleOnly: true }).map((s) => s.scheduleId)).toEqual(["a", "b", "c"]);
    expect(toRouteSuggestions(schedule, [], { titleOnly: true, excluded: ["a", "b"] }).map((s) => s.scheduleId)).toEqual(["c"]);
  });
});

describe("placesToRemoveFor(「入れない」にした時に外す場所)", () => {
  it("予定の場所から作った場所を外す。手を入れた場所(行った・メモを足した・名前を付け直した)は残す", () => {
    const sight = item({ id: "a", date: "2026-09-19", title: "鶴岡八幡宮", location: "鶴岡八幡宮" });
    const base = place("鶴岡八幡宮", { id: "p1", name: "鶴岡八幡宮" });
    expect(placesToRemoveFor(sight, [sight], [base]).map((p) => p.id)).toEqual(["p1"]);
    expect(placesToRemoveFor(sight, [sight], [{ ...base, visited: true }])).toEqual([]);
    expect(placesToRemoveFor(sight, [sight], [{ ...base, memo: "朝一で行く" }])).toEqual([]);
    expect(placesToRemoveFor(sight, [sight], [{ ...base, name: "八幡さま" }])).toEqual([]);
  });

  it("同じ日に同じ場所を使う別の予定があれば、外さない", () => {
    const a = item({ id: "a", date: "2026-09-19", title: "お参り", location: "鶴岡八幡宮" });
    const b = item({ id: "b", date: "2026-09-19", title: "写真", location: "鶴岡八幡宮" });
    expect(placesToRemoveFor(a, [a, b], [place("鶴岡八幡宮", { id: "p1", name: "お参り" })])).toEqual([]);
  });

  it("予定の名前だけで作った場所も外す。ただし手を入れた場所・別の日の場所は残す", () => {
    const temple = item({ id: "t", date: "2026-09-19", title: "長谷寺" });
    const made = place("長谷寺", { id: "p1", name: "長谷寺" });
    expect(placesToRemoveFor(temple, [temple], [made]).map((p) => p.id)).toEqual(["p1"]);
    expect(placesToRemoveFor(temple, [temple], [{ ...made, memo: "紫陽花" }])).toEqual([]);
    expect(placesToRemoveFor(temple, [temple], [{ ...made, date: "2026-09-20" }])).toEqual([]);
    expect(placesToRemoveFor(temple, [temple], [{ ...made, visited: true }])).toEqual([]);
  });

  it("外す場所が無ければ空。名前を付け直した場所が「当たる」かは reflectCovers で分かる", () => {
    const temple = item({ id: "t", date: "2026-09-19", title: "長谷寺" });
    expect(placesToRemoveFor(temple, [temple], [])).toEqual([]);
    expect(reflectCovers(temple, place("長谷寺"))).toBe(true);
    expect(reflectCovers(temple, place("江ノ島"))).toBe(false);
  });
});
