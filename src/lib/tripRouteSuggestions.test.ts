import { describe, expect, it } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { toRouteSuggestions } from "./tripRouteSuggestions";

function item(over: Partial<TripScheduleItem> & { id: string; date: string; title: string }): TripScheduleItem {
  return { tripId: "t1", type: "sightseeing", createdAt: 1, ...over };
}

function place(address: string, date?: string): TripRoutePlace {
  return { id: `p-${address}`, tripId: "t1", name: address, address, sortOrder: 1, date, visited: false, createdAt: 1 };
}

describe("日程からルートの候補を起こす", () => {
  it("場所の入った予定を、日付と時刻の順に候補にする", () => {
    const result = toRouteSuggestions(
      [
        item({ id: "s2", date: "2026-09-20", title: "鶴岡八幡宮", location: "神奈川県鎌倉市雪ノ下2-1-31" }),
        item({ id: "s1", date: "2026-09-19", startTime: "09:30", title: "新幹線 岡山→新横浜", location: "岡山駅", type: "transport" }),
      ],
      [],
    );

    expect(result.map((s) => s.scheduleId)).toEqual(["s1", "s2"]);
    // 移動は駅名そのものを場所の名前にして、列車名はメモへ回す。
    expect(result[0]).toMatchObject({ name: "岡山駅", address: "岡山駅", memo: "新幹線 岡山→新横浜" });
    expect(result[1]).toMatchObject({ name: "鶴岡八幡宮", address: "神奈川県鎌倉市雪ノ下2-1-31" });
  });

  it("場所の無い予定は候補にしない", () => {
    const result = toRouteSuggestions([item({ id: "s1", date: "2026-09-19", title: "起きる" })], []);
    expect(result).toEqual([]);
  });

  it("もうルートに入っている場所は出さない", () => {
    const result = toRouteSuggestions(
      [item({ id: "s1", date: "2026-09-19", title: "新幹線", location: "岡山駅", type: "transport" })],
      [place("岡山駅")],
    );
    expect(result).toEqual([]);
  });

  it("同じ場所の予定が何度あっても候補は1件", () => {
    const result = toRouteSuggestions(
      [
        item({ id: "s1", date: "2026-09-19", title: "行き", location: "岡山駅", type: "transport" }),
        item({ id: "s2", date: "2026-09-26", title: "帰り", location: "岡山駅", type: "transport" }),
      ],
      [],
    );
    expect(result.map((s) => s.scheduleId)).toEqual(["s1"]);
  });
});
