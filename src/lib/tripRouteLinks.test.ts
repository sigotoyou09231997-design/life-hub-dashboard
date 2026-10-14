/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";

const mocks = vi.hoisted(() => ({
  places: [] as unknown[],
  schedule: [] as unknown[],
  added: [] as unknown[],
  scheduleUpdates: [] as [string, unknown][],
  fail: false,
}));

vi.mock("../db/schema", () => ({
  db: {
    tripRoutePlaces: {
      where: () => ({ equals: () => ({ toArray: async () => { if (mocks.fail) throw new Error("read failed"); return mocks.places; } }) }),
      bulkAdd: async (rows: unknown[]) => void mocks.added.push(...rows),
    },
    tripSchedule: {
      where: () => ({ equals: () => ({ toArray: async () => mocks.schedule }) }),
      update: async (id: string, patch: unknown) => void mocks.scheduleUpdates.push([id, patch]),
    },
  },
}));

import { setRouteLinked } from "./routeLink";
import {
  addRouteForNewSchedule,
  describeScheduleFollow,
  followScheduleAfterRouteEdit,
  planRouteAdds,
  planRouteRemoval,
  planScheduleFollow,
  routePlacesToRemove,
} from "./tripRouteLinks";

const DAY = "2026-09-19";
const item = (over: Partial<TripScheduleItem> & { id: string }): TripScheduleItem => ({ tripId: "t1", date: DAY, title: "霊山寺", location: "霊山寺", type: "sightseeing", createdAt: 1, ...over });
const place = (over: Partial<TripRoutePlace> & { id: string }): TripRoutePlace => ({ tripId: "t1", name: "霊山寺", address: "霊山寺", sortOrder: 1, date: DAY, visited: false, createdAt: 1, ...over });

beforeEach(() => {
  window.localStorage.clear();
  Object.assign(mocks, { places: [], schedule: [], added: [], scheduleUpdates: [], fail: false });
});

describe("planRouteAdds(日程を足したら、ルートにも入れる)", () => {
  it("足した日程の、まだルートに無い場所だけを、回る順の末尾に足す。前から候補に残っている別の場所は入れない", () => {
    const fresh = item({ id: "new", title: "大麻比古神社", location: "大麻比古神社" });
    const older = item({ id: "old", title: "児島駅", location: "児島駅" });
    const rows = planRouteAdds(["new"], [older, fresh], [place({ id: "p1", sortOrder: 3, address: "別の場所", name: "別の場所" })], "t1", 99);
    expect(rows).toEqual([{ tripId: "t1", name: "大麻比古神社", address: "大麻比古神社", sortOrder: 4, date: DAY, memo: undefined, visited: false, createdAt: 99 }]);
  });

  it("住所の入った日程は住所で、移動は出発地と目的地の2つを入れる。もうルートにある場所は入れない", () => {
    const withAddress = item({ id: "a", location: "霊山寺", address: "徳島県鳴門市大麻町板東塚鼻126" });
    expect(planRouteAdds(["a"], [withAddress], [], "t1", 1).map((row) => row.address)).toEqual(["徳島県鳴門市大麻町板東塚鼻126"]);
    const move = item({ id: "m", title: "のぞみ13号", type: "transport", location: "東京駅", endLocation: "京都駅" });
    expect(planRouteAdds(["m"], [move], [], "t1", 1).map((row) => row.name)).toEqual(["東京駅", "京都駅"]);
    expect(planRouteAdds(["m"], [move], [place({ id: "p", name: "東京駅", address: "東京駅" })], "t1", 1).map((row) => row.name)).toEqual(["京都駅"]);
  });
});

describe("addRouteForNewSchedule", () => {
  it("DB を読んで、足した日程の場所をルートに入れ、入れた数を返す", async () => {
    mocks.schedule = [item({ id: "new", location: "大麻比古神社", title: "大麻比古神社" })];
    expect(await addRouteForNewSchedule("t1", ["new"])).toBe(1);
    expect(mocks.added).toHaveLength(1);
  });

  it("連動を切っている旅行・足した日程が無い・読み取りの失敗は、何も入れない(0)。失敗しても投げない", async () => {
    mocks.schedule = [item({ id: "new" })];
    setRouteLinked("t1", false);
    expect(await addRouteForNewSchedule("t1", ["new"])).toBe(0);
    setRouteLinked("t1", true);
    expect(await addRouteForNewSchedule("t1", [])).toBe(0);
    mocks.fail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await addRouteForNewSchedule("t1", ["new"])).toBe(0);
    spy.mockRestore();
    expect(mocks.added).toEqual([]);
  });
});

describe("planRouteRemoval(日程を消したら、そこから作ったルートの場所も外す)", () => {
  const deleted = item({ id: "d" });

  it("同じ日・同じ場所で、日程から作られたままのルートの場所を外す対象にする", () => {
    expect(planRouteRemoval(deleted, [], [place({ id: "p1" })]).map((p) => p.id)).toEqual(["p1"]);
  });

  it("日程の元のメモがそのまま付いている場所は外す。自分でメモを書き足した・行った・名前を付け直した・日にちが違う・同じ日にまだ使う日程がある場所は残す", () => {
    const withMemo = item({ id: "d", memo: "朝一番" });
    expect(planRouteRemoval(withMemo, [], [place({ id: "p1", memo: "朝一番" })]).map((p) => p.id)).toEqual(["p1"]);
    expect(planRouteRemoval(withMemo, [], [place({ id: "p1", memo: "駐車場は北側" })])).toEqual([]);
    expect(planRouteRemoval(deleted, [], [place({ id: "p1", visited: true })])).toEqual([]);
    expect(planRouteRemoval(deleted, [], [place({ id: "p1", name: "一番札所" })])).toEqual([]);
    expect(planRouteRemoval(deleted, [], [place({ id: "p1", date: "2026-09-20" })])).toEqual([]);
    expect(planRouteRemoval(deleted, [item({ id: "other", title: "霊山寺で昼食" })], [place({ id: "p1" })])).toEqual([]);
    // 別の日の同じ場所の日程は、数えない。
    expect(planRouteRemoval(deleted, [item({ id: "o2", date: "2026-09-20" })], [place({ id: "p1" })]).map((p) => p.id)).toEqual(["p1"]);
  });

  it("移動なら、出発地と目的地のどちらも外す(名前は場所そのもの、メモは移動の名前)", () => {
    const move = item({ id: "m", title: "のぞみ13号", type: "transport", location: "東京駅", endLocation: "京都駅" });
    const places = [
      place({ id: "a", name: "東京駅", address: "東京駅", memo: "のぞみ13号" }),
      place({ id: "b", name: "京都駅", address: "京都駅", memo: "のぞみ13号", sortOrder: 2 }),
      place({ id: "c", name: "大阪駅", address: "大阪駅", sortOrder: 3 }),
    ];
    expect(planRouteRemoval(move, [], places).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("routePlacesToRemove: DB を読んで調べる。連動を切っていれば空", async () => {
    mocks.places = [place({ id: "p1" })];
    mocks.schedule = [deleted];
    expect((await routePlacesToRemove(deleted)).map((p) => p.id)).toEqual(["p1"]);
    setRouteLinked("t1", false);
    expect(await routePlacesToRemove(deleted)).toEqual([]);
  });
});

describe("planScheduleFollow(ルートを直したら、元の日程も直す)", () => {
  const before = place({ id: "p1" });

  it("住所(場所)を直したら、日程の場所を直す。住所が入っている日程は、その住所を直す。移動の目的地なら目的地", () => {
    expect(planScheduleFollow(before, { ...before, address: "霊山寺 徳島県鳴門市" }, [item({ id: "s1" })])).toEqual([
      { id: "s1", title: "霊山寺", patch: { location: "霊山寺 徳島県鳴門市" }, changed: ["場所"] },
    ]);
    const withAddress = item({ id: "s2", address: "徳島県鳴門市大麻町板東塚鼻126" });
    const placeByAddress = place({ id: "p2", address: "徳島県鳴門市大麻町板東塚鼻126" });
    expect(planScheduleFollow(placeByAddress, { ...placeByAddress, address: "徳島県鳴門市大麻町板東塚鼻127" }, [withAddress])[0].patch).toEqual({ address: "徳島県鳴門市大麻町板東塚鼻127" });
    const move = item({ id: "m", title: "のぞみ13号", type: "transport", location: "東京駅", endLocation: "京都駅" });
    const dest = place({ id: "p3", name: "京都駅", address: "京都駅" });
    expect(planScheduleFollow(dest, { ...dest, address: "京都駅 京都府京都市" }, [move])[0].patch).toEqual({ endLocation: "京都駅 京都府京都市" });
  });

  it("日にちを直したら日程の日にちも(並びから外す)。名前を直したら、題名が元のルートの名前のままの時だけ", () => {
    const plans = planScheduleFollow(before, { ...before, date: "2026-09-20", name: "一番札所 霊山寺" }, [item({ id: "s1" })]);
    expect(plans[0].patch).toEqual({ date: "2026-09-20", sortOrder: null, title: "一番札所 霊山寺" });
    expect(plans[0].changed).toEqual(["日にち", "題名"]);
    // 題名を直してある日程・何日かにまたがる日程の日にち・移動の題名は触らない。
    expect(planScheduleFollow(before, { ...before, name: "別" }, [item({ id: "s1", title: "霊山寺 夜の拝観" })])).toEqual([]);
    expect(planScheduleFollow(before, { ...before, date: "2026-09-20" }, [item({ id: "s1", endDate: "2026-09-21" })])).toEqual([]);
    const move = item({ id: "m", title: "霊山寺", type: "transport", location: "霊山寺", endLocation: "駅" });
    expect(planScheduleFollow(before, { ...before, name: "別" }, [move])).toEqual([]);
  });

  it("日程に当たらない・日にちが違う・日にちの無い場所で複数の日に同じ場所がある時は、何もしない。日にちを「未定」に戻しても日程の日にちは消さない", () => {
    expect(planScheduleFollow(before, { ...before, address: "別" }, [])).toEqual([]);
    expect(planScheduleFollow(before, { ...before, address: "別" }, [item({ id: "s1", date: "2026-09-20" })])).toEqual([]);
    const undated = place({ id: "p9", date: undefined });
    expect(planScheduleFollow(undated, { ...undated, address: "別" }, [item({ id: "a" }), item({ id: "b", date: "2026-09-20" })])).toEqual([]);
    expect(planScheduleFollow(before, { ...before, date: undefined }, [item({ id: "s1" })])).toEqual([]);
  });

  it("同じ日・同じ場所を使う日程が複数あれば、ぜんぶ直す。知らせは題名を並べる", () => {
    const plans = planScheduleFollow(before, { ...before, address: "霊山寺 徳島県鳴門市" }, [item({ id: "a" }), item({ id: "b", title: "霊山寺で昼食", type: "meal" })]);
    expect(plans.map((plan) => plan.id)).toEqual(["a", "b"]);
    expect(describeScheduleFollow(plans)).toBe("日程の「霊山寺」・「霊山寺で昼食」も一緒に直しました(場所)");
  });

  it("followScheduleAfterRouteEdit: DB の日程を直して、知らせの文を返す。連動を切っていれば何もしない", async () => {
    mocks.schedule = [item({ id: "s1" })];
    expect(await followScheduleAfterRouteEdit(before, { ...before, address: "霊山寺 徳島県鳴門市" })).toBe("日程の「霊山寺」も一緒に直しました(場所)");
    expect(mocks.scheduleUpdates).toEqual([["s1", { location: "霊山寺 徳島県鳴門市" }]]);
    mocks.scheduleUpdates = [];
    setRouteLinked("t1", false);
    expect(await followScheduleAfterRouteEdit(before, { ...before, address: "別" })).toBeNull();
    expect(mocks.scheduleUpdates).toEqual([]);
  });
});

describe("目的地の住所の連動(2026-10-15)", () => {
  const ADDR = "京都府京都市下京区烏丸通塩小路下る東塩小路町";
  const move = item({ id: "m", title: "のぞみ13号", type: "transport", location: "東京駅", endLocation: "京都駅", endAddress: ADDR });

  it("ルートの目的地(住所)を直したら、日程の目的地の住所を直す", () => {
    const dest = place({ id: "p", name: "京都駅", address: ADDR });
    expect(planScheduleFollow(dest, { ...dest, address: `${ADDR}1` }, [move])).toEqual([{ id: "m", title: "のぞみ13号", patch: { endAddress: `${ADDR}1` }, changed: ["目的地の住所"] }]);
  });

  it("日程を消したら、住所で作られた目的地のルートの場所も外す。名前のままの目的地も外す", () => {
    const byAddress = place({ id: "a", name: "京都駅", address: ADDR, memo: "のぞみ13号" });
    const byName = place({ id: "b", name: "京都駅", address: "京都駅", memo: "のぞみ13号", sortOrder: 2 });
    expect(planRouteRemoval(move, [], [byAddress]).map((p) => p.id)).toEqual(["a"]);
    expect(planRouteRemoval(move, [], [byName]).map((p) => p.id)).toEqual(["b"]);
  });

  it("足した移動の目的地は、住所でルートに入る", () => {
    const rows = planRouteAdds(["m"], [move], [], "t1", 1);
    expect(rows.map((row) => [row.name, row.address])).toEqual([["東京駅", "東京駅"], ["京都駅", ADDR]]);
  });
});
