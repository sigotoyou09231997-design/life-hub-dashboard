import { describe, expect, it } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { findRoutePlaceFor, toRouteSuggestions } from "./tripRouteSuggestions";

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

describe("場所の欄が空の予定を、予定の名前で候補にする(titleOnly)", () => {
  const opts = { titleOnly: true };

  it("場所も住所も無い予定を、名前を地図の探し言葉にした候補にする。付けなければ今までどおり出さない", () => {
    const schedule = [item({ id: "s1", date: "2026-09-19", startTime: "10:00", title: "鶴岡八幡宮", memo: "朝一で行く" })];
    expect(toRouteSuggestions(schedule, [])).toEqual([]);
    expect(toRouteSuggestions(schedule, [], opts)).toEqual([
      {
        scheduleId: "s1",
        date: "2026-09-19",
        startTime: "10:00",
        name: "鶴岡八幡宮",
        address: "鶴岡八幡宮",
        memo: "朝一で行く",
        title: "鶴岡八幡宮",
        type: "sightseeing",
        fromTitle: true,
      },
    ]);
  });

  it("場所か住所が入っている予定は、今までどおり場所・住所で候補にする(名前の候補にはしない)", () => {
    const result = toRouteSuggestions(
      [
        item({ id: "s1", date: "2026-09-19", title: "昼ごはん", location: "鎌倉駅", type: "meal" }),
        item({ id: "s2", date: "2026-09-19", title: "宿", address: "神奈川県鎌倉市雪ノ下2-1-31", type: "lodging" }),
      ],
      [],
      opts,
    );
    expect(result.map((s) => [s.scheduleId, s.address, s.fromTitle])).toEqual([
      ["s1", "鎌倉駅", undefined],
      ["s2", "神奈川県鎌倉市雪ノ下2-1-31", undefined],
    ]);
  });

  it("移動は、区間の名前では地図に置けないので、場所が空なら出さない", () => {
    const result = toRouteSuggestions([item({ id: "s1", date: "2026-09-19", title: "新幹線 東京→京都", type: "transport" })], [], opts);
    expect(result).toEqual([]);
  });

  it("ルートに同じ名前の場所がもうあれば(名前でも住所でも)出さない。同じ名前の予定は1件にまとめる", () => {
    const named = { ...place("神奈川県鎌倉市雪ノ下2-1-31"), name: "鶴岡八幡宮" };
    expect(toRouteSuggestions([item({ id: "s1", date: "2026-09-19", title: "鶴岡八幡宮" })], [named], opts)).toEqual([]);
    expect(toRouteSuggestions([item({ id: "s1", date: "2026-09-19", title: "江ノ島" })], [place("江ノ島")], opts)).toEqual([]);
    const twice = toRouteSuggestions(
      [item({ id: "s1", date: "2026-09-19", title: "江ノ島" }), item({ id: "s2", date: "2026-09-20", title: " 江ノ島 " })],
      [],
      opts,
    );
    expect(twice.map((s) => s.scheduleId)).toEqual(["s1"]);
  });

  it("名前の空の予定は出さない", () => {
    expect(toRouteSuggestions([item({ id: "s1", date: "2026-09-19", title: "  " })], [], opts)).toEqual([]);
  });
});

describe("日程の場所から、ルートの場所を探す", () => {
  it("住所か名前が同じものを、大文字小文字・前後の空白を見ずに探す", () => {
    const hotel = { ...place("愛媛県松山市千舟町", "2026-12-29"), name: "ダイワロイネットホテル松山" };
    expect(findRoutePlaceFor([place("松山駅"), hotel], " ダイワロイネットホテル松山 ", "2026-12-29")).toBe(hotel);
    expect(findRoutePlaceFor([place("Matsuyama")], "matsuyama")?.address).toBe("Matsuyama");
  });

  it("同じ場所に2回寄るなら、押した日程と同じ日の方を選ぶ", () => {
    const first = place("岡山駅", "2026-12-27");
    const back = { ...place("岡山駅", "2026-12-31"), id: "p-back" };
    expect(findRoutePlaceFor([first, back], "岡山駅", "2026-12-31")).toBe(back);
    expect(findRoutePlaceFor([first, back], "岡山駅", "2026-12-28")).toBe(first);
  });

  it("ルートに無ければ、何も返さない", () => {
    expect(findRoutePlaceFor([place("松山駅")], "道後温泉")).toBeUndefined();
  });
});

describe("日程に住所が入っている時は、住所で候補にする(2026-10-14)", () => {
  const ryozen = item({ id: "s1", date: "2026-09-19", title: "霊山寺", location: "霊山寺", address: "徳島県鳴門市大麻町板東塚鼻126" });

  it("地図に渡す文字は住所。名前は日程の題名のまま", () => {
    const [suggestion] = toRouteSuggestions([ryozen], []);
    expect(suggestion).toMatchObject({ name: "霊山寺", address: "徳島県鳴門市大麻町板東塚鼻126" });
  });

  it("移動は、名前が場所(出発地)そのもの。住所があれば地図には住所を渡す", () => {
    const [suggestion] = toRouteSuggestions([item({ id: "s2", date: "2026-09-19", title: "新幹線", type: "transport", location: "岡山駅", address: "岡山県岡山市北区駅元町1-1" })], []);
    expect(suggestion).toMatchObject({ name: "岡山駅", address: "岡山県岡山市北区駅元町1-1", memo: "新幹線" });
  });

  it("まだ場所の名前のままルートに入っている場所も、「入っている」と数える(候補にまた出さない)。住所で入っていても同じ", () => {
    expect(toRouteSuggestions([ryozen], [place("霊山寺", "2026-09-19")])).toEqual([]);
    expect(toRouteSuggestions([ryozen], [place("徳島県鳴門市大麻町板東塚鼻126", "2026-09-19")])).toEqual([]);
  });

  it("日程の場所を押してルートへ飛ぶ時、場所の名前でも住所でも、ルートの場所を見つける", () => {
    const byAddress = place("徳島県鳴門市大麻町板東塚鼻126", "2026-09-19");
    expect(findRoutePlaceFor([byAddress], "霊山寺", "2026-09-19", "徳島県鳴門市大麻町板東塚鼻126")).toBe(byAddress);
    expect(findRoutePlaceFor([byAddress], "霊山寺", "2026-09-19")).toBeUndefined();
    const byName = place("霊山寺", "2026-09-19");
    expect(findRoutePlaceFor([byName], "霊山寺", "2026-09-19", "徳島県鳴門市大麻町板東塚鼻126")).toBe(byName);
  });
});

describe("移動の目的地もルートの候補にする(2026-10-14)", () => {
  const shinkansen = item({ id: "m1", date: "2026-09-19", startTime: "08:00", endTime: "10:15", title: "のぞみ13号", type: "transport", location: "東京駅", endLocation: "京都駅" });

  it("出発地と目的地を、別々の候補にする。目的地の名前は場所そのもの、メモに移動の名前", () => {
    const result = toRouteSuggestions([shinkansen], []);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ scheduleId: "m1", name: "東京駅", address: "東京駅", memo: "のぞみ13号" });
    // 目的地は、到着時刻の順に並ぶ。印は元の予定の id に「#end」を付けたもの。
    expect(result[1]).toMatchObject({ scheduleId: "m1#end", name: "京都駅", address: "京都駅", startTime: "10:15", memo: "のぞみ13号" });
  });

  it("もうルートに入っている場所は、出発地でも目的地でも出さない。同じ場所は1回だけ", () => {
    expect(toRouteSuggestions([shinkansen], [place("京都駅", "2026-09-19")]).map((s) => s.name)).toEqual(["東京駅"]);
    expect(toRouteSuggestions([shinkansen, { ...shinkansen, id: "m2", location: "京都駅", endLocation: "大阪駅", startTime: "12:00" }], []).map((s) => s.name)).toEqual(["東京駅", "京都駅", "大阪駅"]);
  });

  it("移動でない予定の目的地欄は、候補にしない", () => {
    expect(toRouteSuggestions([item({ id: "s1", date: "2026-09-19", title: "清水寺", location: "清水寺", endLocation: "どこか" })], []).map((s) => s.name)).toEqual(["清水寺"]);
  });
});

describe("移動の目的地の住所をルートの候補にする(2026-10-15)", () => {
  const move = item({ id: "m1", date: "2026-09-19", startTime: "08:00", endTime: "10:15", title: "のぞみ13号", type: "transport", location: "東京駅", address: "東京都千代田区丸の内1-9-1", endLocation: "京都駅", endAddress: "京都府京都市下京区烏丸通塩小路下る東塩小路町" });

  it("出発地・目的地とも、地図に渡す文字は住所。名前は場所の名前のまま", () => {
    const result = toRouteSuggestions([move], []);
    expect(result.map((s) => [s.name, s.address])).toEqual([
      ["東京駅", "東京都千代田区丸の内1-9-1"],
      ["京都駅", "京都府京都市下京区烏丸通塩小路下る東塩小路町"],
    ]);
  });

  it("まだ名前のままルートに入っている目的地も「入っている」と数える(候補にまた出さない)", () => {
    expect(toRouteSuggestions([move], [place("京都駅", "2026-09-19")]).map((s) => s.name)).toEqual(["東京駅"]);
    expect(toRouteSuggestions([move], [place("京都府京都市下京区烏丸通塩小路下る東塩小路町", "2026-09-19")]).map((s) => s.name)).toEqual(["東京駅"]);
  });
});
