import { describe, expect, it } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { buildRouteTimeline, estimateArrival, gapMinutes, toClock, toMinutes, type TimelineStop } from "./tripRouteTimeline";

function place(id: string, name: string, address: string, date?: string): TripRoutePlace {
  return { id, tripId: "t1", name, address, sortOrder: 1, date, visited: false, createdAt: 1 };
}

function item(over: Partial<TripScheduleItem> & Pick<TripScheduleItem, "title">): TripScheduleItem {
  return { id: over.title, tripId: "t1", date: "2026-12-27", type: "sightseeing", createdAt: 1, ...over };
}

describe("toMinutes / toClock", () => {
  it("HH:mm を分にし、24時を超えたら「翌」を付けて戻す", () => {
    expect(toMinutes("09:05")).toBe(545);
    expect(toMinutes("9:05")).toBe(545);
    expect(toMinutes("24:00")).toBeUndefined();
    expect(toMinutes("ab")).toBeUndefined();
    expect(toMinutes(undefined)).toBeUndefined();
    expect(toClock(545)).toBe("09:05");
    expect(toClock(24 * 60 + 30)).toBe("翌00:30");
  });
});

describe("buildRouteTimeline", () => {
  it("場所の住所と日にちが同じ日程から、時刻と見出しを借りる(順番は動かさない)", () => {
    const places = [place("a", "高松駅", "高松駅", "2026-12-27"), place("b", "うどん店", "香川県高松市1-1", "2026-12-27")];
    const schedule = [
      item({ title: "さぬきうどん", location: "香川県高松市1-1", startTime: "12:00", endTime: "13:00" }),
      item({ title: "高松駅", location: "高松駅", startTime: "10:30", type: "transport" }),
    ];

    const stops = buildRouteTimeline(places, schedule);

    expect(stops.map((s) => s.place.id)).toEqual(["a", "b"]);
    expect(stops[0]).toMatchObject({ startTime: "10:30", endTime: undefined, title: undefined });
    expect(stops[1]).toMatchObject({ startTime: "12:00", endTime: "13:00", title: "さぬきうどん" });
  });

  it("手で入れた場所は、名前が日程の見出しか場所と同じなら一致とする(部分一致はしない)", () => {
    const stops = buildRouteTimeline(
      [
        place("a", "清水寺", "京都市東山区清水1丁目294", "2026-12-27"),
        place("b", "京都駅", "京都市下京区烏丸通塩小路下る", "2026-12-27"),
        place("c", "四条のホテル", "京都市下京区四条", "2026-12-27"),
      ],
      [
        item({ title: "清水寺", startTime: "09:00" }),
        item({ title: "京都駅前のホテルに移動", location: "京都駅前", startTime: "11:00" }),
        item({ title: "チェックイン", location: "四条のホテル", startTime: "16:00" }),
      ],
    );
    expect(stops.map((s) => s.startTime)).toEqual(["09:00", undefined, "16:00"]);
  });

  it("日にちが違う予定からは借りない", () => {
    const stops = buildRouteTimeline(
      [place("a", "高松駅", "高松駅", "2026-12-28")],
      [item({ title: "高松駅", location: "高松駅", startTime: "10:30", date: "2026-12-27" })],
    );
    expect(stops[0].startTime).toBeUndefined();
  });

  it("日にちの無い場所は、同じ住所の予定が1日だけの時に限って借りる", () => {
    const one = buildRouteTimeline(
      [place("a", "高松駅", "高松駅")],
      [item({ title: "到着", location: "高松駅", startTime: "10:30" })],
    );
    expect(one[0].startTime).toBe("10:30");

    const two = buildRouteTimeline(
      [place("a", "高松駅", "高松駅")],
      [
        item({ title: "到着", location: "高松駅", startTime: "10:30", date: "2026-12-27" }),
        item({ title: "出発", location: "高松駅", startTime: "17:00", date: "2026-12-29" }),
      ],
    );
    expect(two[0].startTime).toBeUndefined();
  });

  it("同じ場所に同じ日の予定が複数なら、いちばん早い時刻を使う(時刻の無いものは後ろ)", () => {
    const stops = buildRouteTimeline(
      [place("a", "宿", "宿の住所", "2026-12-27")],
      [
        item({ title: "夕食", location: "宿の住所", startTime: "18:30" }),
        item({ title: "メモだけ", location: "宿の住所" }),
        item({ title: "チェックイン", location: "宿の住所", startTime: "15:00" }),
      ],
    );
    expect(stops[0]).toMatchObject({ startTime: "15:00", title: "チェックイン" });
  });

  it("大文字小文字・前後の空白の違いは同じ場所として扱う", () => {
    const stops = buildRouteTimeline(
      [place("a", "Cafe", " Cafe Tokyo ", "2026-12-27")],
      [item({ title: "お茶", location: "cafe tokyo", startTime: "14:00" })],
    );
    expect(stops[0].startTime).toBe("14:00");
  });
});

describe("gapMinutes / estimateArrival", () => {
  const stop = (startTime?: string, endTime?: string): TimelineStop => ({ place: place("x", "x", "x"), startTime, endTime });

  it("前の場所の終了時刻から、次の開始時刻までの分を出す", () => {
    expect(gapMinutes(stop("10:00", "11:00"), stop("12:30"))).toBe(90);
    expect(gapMinutes(stop("10:00", "11:00"), stop("10:50"))).toBe(-10);
  });

  it("終了時刻か開始時刻が分からなければ出さない(当てずっぽうを避ける)", () => {
    expect(gapMinutes(stop("10:00"), stop("12:30"))).toBeUndefined();
    expect(gapMinutes(stop("10:00", "11:00"), stop(undefined))).toBeUndefined();
  });

  it("着く目安は、前の終了時刻に移動時間を足す。終了時刻が無ければ出さない", () => {
    expect(estimateArrival(stop("10:00", "11:00"), 35 * 60)).toBe("11:35");
    expect(estimateArrival(stop("10:00", "11:00"), 35 * 60 + 1)).toBe("11:36");
    expect(estimateArrival(stop("23:30", "23:50"), 30 * 60)).toBe("翌00:20");
    expect(estimateArrival(stop("10:00"), 35 * 60)).toBeUndefined();
    expect(estimateArrival(stop("10:00", "11:00"), undefined)).toBeUndefined();
  });
});
