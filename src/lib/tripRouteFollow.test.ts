/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";

const mocks = vi.hoisted(() => ({
  places: [] as unknown[],
  schedule: [] as unknown[],
  updated: [] as [string, unknown][],
  failRead: false,
}));

vi.mock("../db/schema", () => ({
  db: {
    tripRoutePlaces: {
      where: () => ({
        equals: () => ({
          toArray: async () => {
            if (mocks.failRead) throw new Error("read failed");
            return mocks.places;
          },
        }),
      }),
      update: async (id: string, patch: unknown) => void mocks.updated.push([id, patch]),
    },
    tripSchedule: { where: () => ({ equals: () => ({ toArray: async () => mocks.schedule }) }) },
  },
}));

import { describeRouteFollow, describeRouteFollowAll, followRouteAfterEdit, planAddressReflect, planRouteFollow, planRouteFollowAll } from "./tripRouteFollow";

beforeEach(() => {
  mocks.places = [];
  mocks.schedule = [];
  mocks.updated = [];
  mocks.failRead = false;
});

const DAY1 = "2026-10-19";
const DAY2 = "2026-10-20";

function item(over: Partial<TripScheduleItem> & { id: string }): TripScheduleItem {
  return { tripId: "t1", date: DAY1, title: "清水寺", location: "清水寺", type: "sightseeing", createdAt: 1, ...over };
}
function place(over: Partial<TripRoutePlace> & { id: string }): TripRoutePlace {
  return { tripId: "t1", name: "清水寺", address: "清水寺", sortOrder: 1, date: DAY1, visited: false, createdAt: 1, ...over };
}

describe("planRouteFollow(日程を直したら、ルートの場所も追いかける)", () => {
  it("場所を直したら、同じ日・同じ場所のルートの場所の住所を新しい場所にする", () => {
    const before = item({ id: "s1" });
    const after = { ...before, location: "清水寺 京都府京都市東山区" };
    const plan = planRouteFollow(before, after, [], [place({ id: "p1" })]);
    expect(plan).toMatchObject({ id: "p1", patch: { address: "清水寺 京都府京都市東山区" }, changed: ["場所"] });
    expect(describeRouteFollow(plan!)).toBe("ルートの「清水寺」も一緒に直しました(場所)");
  });

  it("日にちを直したら、ルートの場所の日にちも動く", () => {
    const before = item({ id: "s1" });
    const plan = planRouteFollow(before, { ...before, date: DAY2 }, [], [place({ id: "p1" })]);
    expect(plan).toMatchObject({ id: "p1", patch: { date: DAY2 }, changed: ["日にち"] });
  });

  it("題名を直したら、日程から作られたままの名前は追いかける。ルートで自分で付け直した名前は触らない", () => {
    const before = item({ id: "s1" });
    const after = { ...before, title: "清水寺(夜の特別拝観)" };
    expect(planRouteFollow(before, after, [], [place({ id: "p1" })])).toMatchObject({ patch: { name: "清水寺(夜の特別拝観)" }, changed: ["名前"] });
    expect(planRouteFollow(before, after, [], [place({ id: "p1", name: "夜桜を見る所" })])).toBeNull();
  });

  it("移動の日程は、名前が場所そのもの。場所を直せば、住所と名前が一緒に変わる", () => {
    const before = item({ id: "s1", type: "transport", title: "のぞみ13号", location: "東京駅" });
    const after = { ...before, location: "新横浜駅" };
    const plan = planRouteFollow(before, after, [], [place({ id: "p1", name: "東京駅", address: "東京駅" })]);
    expect(plan).toMatchObject({ patch: { address: "新横浜駅", name: "新横浜駅" }, changed: ["場所", "名前"] });
  });

  it("場所・日にち・題名を一度に直しても、1回で全部追いかける", () => {
    const before = item({ id: "s1" });
    const after = { ...before, title: "伏見稲荷", location: "伏見稲荷大社", date: DAY2 };
    const plan = planRouteFollow(before, after, [], [place({ id: "p1" })]);
    expect(plan?.patch).toEqual({ address: "伏見稲荷大社", date: DAY2, name: "伏見稲荷" });
    expect(plan?.changed).toEqual(["場所", "日にち", "名前"]);
  });

  it("日程のほかの所(メモ・時刻など)だけ直した時は、何もしない", () => {
    const before = item({ id: "s1" });
    expect(planRouteFollow(before, { ...before, memo: "拝観料 500円", startTime: "09:00" }, [], [place({ id: "p1" })])).toBeNull();
  });

  it("大文字小文字・前後の空白の違いは同じ場所とみなす", () => {
    const before = item({ id: "s1", location: "  Kyoto Station " });
    const plan = planRouteFollow(before, { ...before, location: "京都駅" }, [], [place({ id: "p1", name: "駅", address: "kyoto station" })]);
    expect(plan).toMatchObject({ id: "p1", patch: { address: "京都駅" } });
  });

  describe("取り違えのおそれがある時は、何もしない(古いまま残る方が、別の場所を書き換えるより安全)", () => {
    it("直す前の場所・日にちと同じルートの場所が無い(日にちが違う・日にちが決まっていない・場所が違う)", () => {
      const before = item({ id: "s1" });
      const after = { ...before, location: "金閣寺" };
      expect(planRouteFollow(before, after, [], [place({ id: "p1", date: DAY2 })])).toBeNull();
      expect(planRouteFollow(before, after, [], [place({ id: "p1", date: undefined })])).toBeNull();
      expect(planRouteFollow(before, after, [], [place({ id: "p1", address: "二条城", name: "二条城" })])).toBeNull();
      expect(planRouteFollow(before, after, [], [])).toBeNull();
    });

    it("直す前に場所が無かった日程は、追いかけるものが無い", () => {
      const before = item({ id: "s1", location: undefined });
      expect(planRouteFollow(before, { ...before, location: "金閣寺" }, [], [place({ id: "p1" })])).toBeNull();
    });

    it("同じ日の別の日程が、まだ同じ場所を使っているなら、その場所はまだ要るので触らない", () => {
      const before = item({ id: "s1" });
      const other = item({ id: "s2", title: "清水寺で夕食", type: "meal" });
      expect(planRouteFollow(before, { ...before, location: "金閣寺" }, [other], [place({ id: "p1" })])).toBeNull();
      // 別の日に同じ場所を使う日程があっても、その日のルートの場所は別なので、こちらは追いかける。
      const otherDay = item({ id: "s3", date: DAY2 });
      expect(planRouteFollow(before, { ...before, location: "金閣寺" }, [otherDay], [place({ id: "p1" }), place({ id: "p2", date: DAY2 })])).toMatchObject({ id: "p1" });
    });

    it("場所を空にしても、ルートからは消さない・場所は変えない", () => {
      const before = item({ id: "s1" });
      expect(planRouteFollow(before, { ...before, location: undefined }, [], [place({ id: "p1" })])).toBeNull();
      expect(planRouteFollow(before, { ...before, location: "  " }, [], [place({ id: "p1" })])).toBeNull();
    });

    it("新しい場所が、すでにルートの別の場所として入っていたら、場所は変えない(日にちなど、ほかは追いかける)", () => {
      const before = item({ id: "s1" });
      const places = [place({ id: "p1" }), place({ id: "p2", name: "金閣寺", address: "金閣寺", date: DAY2, sortOrder: 2 })];
      expect(planRouteFollow(before, { ...before, location: "金閣寺" }, [], places)).toBeNull();
      expect(planRouteFollow(before, { ...before, location: "金閣寺", date: DAY2 }, [], places)).toMatchObject({ patch: { date: DAY2 }, changed: ["日にち"] });
    });
  });

  it("同じ場所のルートの場所が同じ日に2つあれば、回る順が先のものを直す(もう1つは残す)", () => {
    const before = item({ id: "s1" });
    const plan = planRouteFollow(before, { ...before, location: "金閣寺" }, [], [place({ id: "p2", sortOrder: 5 }), place({ id: "p1", sortOrder: 2 })]);
    expect(plan?.id).toBe("p1");
  });
});

describe("followRouteAfterEdit(保存のあとに、ルートの場所を直す)", () => {
  it("直す必要があれば、ルートの場所を更新して、知らせの文を返す。直した日程自身は『ほかの日程』に数えない", async () => {
    const before = item({ id: "s1" });
    const after = { ...before, location: "清水寺 京都府京都市東山区" };
    mocks.places = [place({ id: "p1" })];
    // 保存したあとの日程の表には、直した日程自身(新しい場所)も、別の日の日程も入っている。
    mocks.schedule = [after, item({ id: "s3", date: DAY2 })];
    expect(await followRouteAfterEdit(before, after)).toBe("ルートの「清水寺」も一緒に直しました(場所)");
    expect(mocks.updated).toEqual([["p1", { address: "清水寺 京都府京都市東山区" }]]);
  });

  it("同じ日の別の日程が同じ場所を使っていれば、何も更新せず null", async () => {
    const before = item({ id: "s1" });
    mocks.places = [place({ id: "p1" })];
    mocks.schedule = [{ ...before, location: "金閣寺" }, item({ id: "s2", title: "清水寺で夕食", type: "meal" })];
    expect(await followRouteAfterEdit(before, { ...before, location: "金閣寺" })).toBeNull();
    expect(mocks.updated).toEqual([]);
  });

  it("読み書きに失敗しても、投げない(日程の保存はもう済んでいる)。知らせは出さない", async () => {
    const before = item({ id: "s1" });
    mocks.failRead = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await followRouteAfterEdit(before, { ...before, location: "金閣寺" })).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("住所を足す・直すと、ルートの場所の住所も追いかける(2026-10-14)", () => {
  const ADDRESS = "徳島県鳴門市大麻町板東塚鼻126";

  it("住所を足したら、場所の名前のままのルートの場所を、住所に直す。名前(題名)はそのまま", () => {
    const before = item({ id: "s1", title: "霊山寺", location: "霊山寺" });
    const plan = planRouteFollow(before, { ...before, address: ADDRESS }, [], [place({ id: "p1", name: "霊山寺", address: "霊山寺" })]);
    expect(plan).toMatchObject({ id: "p1", patch: { address: ADDRESS }, changed: ["場所"] });
  });

  it("住所を直したら、住所で作られているルートの場所の住所も直す", () => {
    const before = item({ id: "s1", title: "霊山寺", location: "霊山寺", address: ADDRESS });
    const plan = planRouteFollow(before, { ...before, address: "徳島県鳴門市大麻町板東塚鼻127" }, [], [place({ id: "p1", name: "霊山寺", address: ADDRESS })]);
    expect(plan?.patch).toEqual({ address: "徳島県鳴門市大麻町板東塚鼻127" });
  });

  it("住所を入れてあるのに、ルートの場所がまだ名前のままの時は、日程を保存し直すだけで住所に直る(住所は変えていなくても)", () => {
    const before = item({ id: "s1", title: "霊山寺", location: "霊山寺", address: ADDRESS });
    const plan = planRouteFollow(before, { ...before, memo: "拝観は朝" }, [], [place({ id: "p1", name: "霊山寺", address: "霊山寺" })]);
    expect(plan).toMatchObject({ id: "p1", patch: { address: ADDRESS } });
  });

  it("住所を消したら、場所に戻す。もうルートに同じ住所の場所があれば、変えない", () => {
    const before = item({ id: "s1", title: "霊山寺", location: "霊山寺", address: ADDRESS });
    expect(planRouteFollow(before, { ...before, address: undefined }, [], [place({ id: "p1", name: "霊山寺", address: ADDRESS })])?.patch).toEqual({ address: "霊山寺" });
    const dup = place({ id: "p2", name: "別の名前", address: ADDRESS, sortOrder: 2 });
    expect(planRouteFollow(item({ id: "s1", title: "霊山寺", location: "霊山寺" }), { ...before }, [], [place({ id: "p1", name: "霊山寺", address: "霊山寺" }), dup])).toBeNull();
  });
});

describe("planAddressReflect(日程に住所が入っているのに、名前のままのルートの場所)", () => {
  const ADDRESS = "徳島県鳴門市大麻町板東塚鼻126";
  const withAddress = item({ id: "s1", title: "霊山寺", location: "霊山寺", address: ADDRESS });

  it("同じ日・同じ場所の日程に住所があれば、住所に直す案を返す", () => {
    expect(planAddressReflect([withAddress], [place({ id: "p1", name: "霊山寺", address: "霊山寺" })])).toEqual([{ id: "p1", placeName: "霊山寺", address: ADDRESS }]);
  });

  it("住所の無い日程・もう住所のルートの場所・日にちが違う・日にちが決まっていない場所・同じ住所がもうルートにある場合は、出さない", () => {
    const named = place({ id: "p1", name: "霊山寺", address: "霊山寺" });
    expect(planAddressReflect([item({ id: "s1", title: "霊山寺", location: "霊山寺" })], [named])).toEqual([]);
    expect(planAddressReflect([withAddress], [place({ id: "p1", name: "霊山寺", address: ADDRESS })])).toEqual([]);
    expect(planAddressReflect([withAddress], [{ ...named, date: "2026-10-20" }])).toEqual([]);
    expect(planAddressReflect([withAddress], [{ ...named, date: undefined }])).toEqual([]);
    expect(planAddressReflect([withAddress], [named, place({ id: "p2", name: "もう1つ", address: ADDRESS, sortOrder: 2 })])).toEqual([]);
  });

  it("同じ住所に直す場所が2つ並んでも、1つだけ(同じ住所が2つにならない)", () => {
    const places = [place({ id: "p1", name: "霊山寺", address: "霊山寺" }), place({ id: "p2", name: "霊山寺(2)", address: "霊山寺", sortOrder: 2 })];
    expect(planAddressReflect([withAddress], places)).toHaveLength(1);
  });
});

describe("planRouteFollowAll: 移動の目的地も追いかける(2026-10-14)", () => {
  const move = (over: Partial<TripScheduleItem> = {}) => item({ id: "m1", title: "のぞみ13号", type: "transport", location: "東京駅", endLocation: "京都駅", ...over });

  it("目的地を直したら、目的地のルートの場所を直す(出発地はそのまま)", () => {
    const before = move();
    const places = [place({ id: "a", name: "東京駅", address: "東京駅" }), place({ id: "b", name: "京都駅", address: "京都駅", sortOrder: 2 })];
    const plans = planRouteFollowAll(before, { ...before, endLocation: "新大阪駅" }, [], places);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: "b", patch: { address: "新大阪駅", name: "新大阪駅" }, changed: ["場所", "名前"] });
  });

  it("出発地も目的地も直したら、2つの場所を直す。知らせは両方の名前", () => {
    const before = move();
    const places = [place({ id: "a", name: "東京駅", address: "東京駅" }), place({ id: "b", name: "京都駅", address: "京都駅", sortOrder: 2 })];
    const plans = planRouteFollowAll(before, { ...before, location: "品川駅", endLocation: "新大阪駅" }, [], places);
    expect(plans.map((plan) => plan.id)).toEqual(["a", "b"]);
    expect(describeRouteFollowAll(plans)).toBe("ルートの「東京駅」・「京都駅」も一緒に直しました");
  });

  it("目的地を足しただけ(前は無い)・移動でない予定は、目的地の分は何もしない", () => {
    const before = move({ endLocation: undefined });
    expect(planRouteFollowAll(before, { ...before, endLocation: "京都駅" }, [], [place({ id: "a", name: "東京駅", address: "東京駅" })])).toEqual([]);
    const sight = item({ id: "s", title: "清水寺", location: "清水寺", endLocation: "どこか" });
    expect(planRouteFollowAll(sight, { ...sight, endLocation: "別" }, [], [place({ id: "p", name: "どこか", address: "どこか" })])).toEqual([]);
  });

  it("同じ日の別の日程が、まだその目的地を出発地にしている(次の移動)なら、触らない", () => {
    const before = move();
    const next = item({ id: "m2", title: "移動", type: "transport", location: "京都駅", endLocation: "大阪駅" });
    expect(planRouteFollowAll(before, { ...before, endLocation: "新大阪駅" }, [next], [place({ id: "b", name: "京都駅", address: "京都駅" })])).toEqual([]);
  });
});

describe("連動を切っている旅行では、日程を直してもルートに触らない(2026-10-14)", () => {
  it("followRouteAfterEdit は、連動を切っていれば null で、ルートを更新しない", async () => {
    const before = item({ id: "s1" });
    mocks.places = [place({ id: "p1" })];
    mocks.schedule = [before];
    window.localStorage.setItem("lifeHubRouteLink:t1", "0");
    expect(await followRouteAfterEdit(before, { ...before, location: "金閣寺" })).toBeNull();
    expect(mocks.updated).toEqual([]);
    window.localStorage.removeItem("lifeHubRouteLink:t1");
    expect(await followRouteAfterEdit(before, { ...before, location: "金閣寺" })).not.toBeNull();
  });
});

describe("目的地の住所の連動(2026-10-15)", () => {
  const ADDR = "京都府京都市下京区烏丸通塩小路下る東塩小路町";
  const move = (over: Partial<TripScheduleItem> = {}) => item({ id: "m1", title: "のぞみ13号", type: "transport", location: "東京駅", endLocation: "京都駅", ...over });

  it("目的地の住所を足したら、名前のままの目的地のルートの場所を住所に直す(名前はそのまま)", () => {
    const before = move();
    const plans = planRouteFollowAll(before, { ...before, endAddress: ADDR }, [], [place({ id: "a", name: "東京駅", address: "東京駅" }), place({ id: "b", name: "京都駅", address: "京都駅", sortOrder: 2 })]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: "b", patch: { address: ADDR }, changed: ["場所"] });
  });

  it("目的地の住所を直したら、住所で作られているルートの場所の住所も直す", () => {
    const before = move({ endAddress: ADDR });
    const plans = planRouteFollowAll(before, { ...before, endAddress: "京都府京都市下京区烏丸通塩小路下る東塩小路町1" }, [], [place({ id: "b", name: "京都駅", address: ADDR })]);
    expect(plans[0].patch).toEqual({ address: "京都府京都市下京区烏丸通塩小路下る東塩小路町1" });
  });

  it("planAddressReflect: 日程に目的地の住所が入っているのに、名前のままのルートの目的地を、住所に直す案にする", () => {
    const schedule = [move({ endAddress: ADDR })];
    expect(planAddressReflect(schedule, [place({ id: "b", name: "京都駅", address: "京都駅" })])).toEqual([{ id: "b", placeName: "京都駅", address: ADDR }]);
    // 出発地の住所も同じ日程にあれば、出発地は出発地の住所へ。
    const both = [move({ address: "東京都千代田区丸の内1-9-1", endAddress: ADDR })];
    expect(planAddressReflect(both, [place({ id: "a", name: "東京駅", address: "東京駅" }), place({ id: "b", name: "京都駅", address: "京都駅", sortOrder: 2 })]).map((r) => r.address)).toEqual(["東京都千代田区丸の内1-9-1", ADDR]);
  });
});
