import { describe, expect, it } from "vitest";
import type { Trip } from "../types";
import {
  describePlanImportError,
  isOutsideTrip,
  pickDefaultTripId,
  sortTripsForPicker,
  toCalendarEventRecord,
  toImportRows,
  toTaskRecord,
  toTripScheduleRecord,
} from "./mailPlanImport";

const trip = (id: string, startDate: string, endDate: string): Trip => ({
  id,
  name: id,
  destination: "どこか",
  startDate,
  endDate,
  status: "planning",
  createdAt: 0,
});

const item = (date: string) => ({ date, title: "移動", type: "transport" as const });

describe("pickDefaultTripId", () => {
  it("読み取った日付を含む旅行を選ぶ", () => {
    const trips = [trip("a", "2026-07-01", "2026-07-03"), trip("b", "2026-09-11", "2026-09-15")];
    expect(pickDefaultTripId(trips, [item("2026-09-12")])).toBe("b");
  });

  it("含む旅行が無ければ、いちばん日付が近い旅行を選ぶ", () => {
    const trips = [trip("a", "2026-01-01", "2026-01-03"), trip("b", "2026-09-20", "2026-09-22")];
    expect(pickDefaultTripId(trips, [item("2026-09-12")])).toBe("b");
  });

  it("旅行が1つも無ければ選ばない", () => {
    expect(pickDefaultTripId([], [item("2026-09-12")])).toBeUndefined();
  });

  it("読み取れた日程が無ければ、とりあえず先頭の旅行", () => {
    const trips = [trip("a", "2026-07-01", "2026-07-03")];
    expect(pickDefaultTripId(trips, [])).toBe("a");
  });
});

describe("isOutsideTrip", () => {
  it("旅行の期間から外れていれば印を出す", () => {
    // 保存はできるが日付タブに出てこないので、気付けるようにする。
    expect(isOutsideTrip(trip("a", "2026-09-11", "2026-09-15"), "2026-09-20")).toBe(true);
    expect(isOutsideTrip(trip("a", "2026-09-11", "2026-09-15"), "2026-09-12")).toBe(false);
  });

  it("旅行が選ばれていなければ印は出さない", () => {
    expect(isOutsideTrip(undefined, "2026-09-20")).toBe(false);
  });
});

describe("toImportRows", () => {
  it("読み取った分は最初から入れる扱いにする(外したいものだけ外す)", () => {
    expect(toImportRows([item("2026-09-12")])[0].checked).toBe(true);
  });
});

describe("sortTripsForPicker", () => {
  it("新しい旅行ほど上に並べる", () => {
    // 並べ替えはDexieに任せず必ずここでやる — tripsの索引は id だけで、
    // orderBy("startDate") は例外になり、画面ごと落ちる。
    const trips = [trip("a", "2026-01-01", "2026-01-03"), trip("b", "2026-09-11", "2026-09-15")];
    expect(sortTripsForPicker(trips).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("渡された配列は書き換えない", () => {
    const trips = [trip("a", "2026-01-01", "2026-01-03"), trip("b", "2026-09-11", "2026-09-15")];
    sortTripsForPicker(trips);
    expect(trips.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

const row = (over: Partial<import("./mailPlanImport").TripImportRow> = {}) => ({
  checked: true,
  date: "2026-09-12",
  title: " 羽田→福岡 ",
  type: "transport" as const,
  ...over,
});

describe("入れ先ごとの作り分け", () => {
  it("旅行の日程は、種類と場所をそのまま持つ", () => {
    const record = toTripScheduleRecord(row({ startTime: "08:20", location: "羽田空港" }), "trip-1", 1_000);
    expect(record).toEqual({
      tripId: "trip-1",
      date: "2026-09-12",
      startTime: "08:20",
      title: "羽田→福岡",
      location: "羽田空港",
      memo: undefined,
      type: "transport",
      createdAt: 1_000,
    });
  });

  it("予定は、時刻が読み取れていれば時刻つきにする", () => {
    const record = toCalendarEventRecord(row({ startTime: "08:20" }), 1_000);
    expect(record.allDay).toBe(false);
    expect(record.startTime).toBe("08:20");
  });

  it("予定は、時刻が読み取れなければ終日にする", () => {
    // 時刻なしのまま置くと0:00の予定に見えるうえ、通知の起点も無い。
    const record = toCalendarEventRecord(row(), 1_000);
    expect(record.allDay).toBe(true);
    expect(record.startTime).toBeUndefined();
  });

  it("タスクは、読み取った日付を期限にする", () => {
    const record = toTaskRecord(row({ startTime: "08:20" }), 1_000);
    expect(record.dueDate).toBe("2026-09-12");
    expect(record.dueTime).toBe("08:20");
    expect(record.completed).toBe(false);
    expect(record.priority).toBe("medium");
  });

  it("どの入れ先でも、前後の空白は落とす", () => {
    expect(toTaskRecord(row(), 1_000).title).toBe("羽田→福岡");
    expect(toCalendarEventRecord(row(), 1_000).title).toBe("羽田→福岡");
  });
});

describe("describePlanImportError", () => {
  it("関数が見つからない時は、アプリを開き直すよう伝える", () => {
    // 「extractTripPlan failed (405)」のままでは何をすればよいか分からない。
    expect(describePlanImportError(Object.assign(new Error("extractTripPlan failed (405)"), { status: 405 }))).toContain(
      "開き直して",
    );
    expect(describePlanImportError(Object.assign(new Error("not found"), { status: 404 }))).toContain("開き直して");
  });

  it("混み合っている時は、待てば直ると伝える", () => {
    expect(describePlanImportError(Object.assign(new Error("rate limited"), { status: 429 }))).toContain("少し待って");
  });

  it("接続情報が無い時は、どの環境変数かまで伝える", () => {
    expect(describePlanImportError(new Error("サーバーにAIの接続情報(ANTHROPIC_API_KEY)が..."))).toContain(
      "ANTHROPIC_API_KEY",
    );
  });

  it("当てはまるものが無ければ、元のメッセージをそのまま出す", () => {
    expect(describePlanImportError(new Error("Anthropic API error: 529"))).toBe("Anthropic API error: 529");
  });
});
