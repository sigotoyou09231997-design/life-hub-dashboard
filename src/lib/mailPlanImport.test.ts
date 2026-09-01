import { describe, expect, it } from "vitest";
import type { Trip } from "../types";
import {
  PLAN_GROUPS,
  findSimilarPlan,
  normalizePlanTitle,
  describeCounts,
  describePlanImportError,
  describeSaved,
  otherDestinations,
  sortDestinations,
  toDestination,
  isRouteAlreadyRegistered,
  needsTrip,
  nextRouteSortOrder,
  routeKey,
  toRouteImportRows,
  toTripRoutePlaceRecord,
  isAlreadyRegistered,
  isOutsideTrip,
  mergeDuplicateItems,
  pickDefaultTripId,
  planKey,
  toExpenseCategory,
  toTripExpenseRecord,
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

  it("金額が読み取れたものは、費用にも入れる前提にする", () => {
    expect(toImportRows([{ ...item("2026-09-12"), amount: 12540 }])[0].withExpense).toBe(true);
  });

  it("金額が無ければ、費用は入れない", () => {
    expect(toImportRows([item("2026-09-12")])[0].withExpense).toBe(false);
  });
});

describe("mergeDuplicateItems", () => {
  const plan = (title: string, over: Partial<{ startTime: string; endTime: string; location: string; memo: string }> = {}) => ({
    date: "2026-09-03",
    title,
    type: "other" as const,
    ...over,
  });

  it("同じ用件が粒度違いで2件返ってきたら、1件にまとめる", () => {
    // 実際に起きた形: 件名からの「株式会社Widsley 面接」と、本文からの「一次面接 12:15〜」。
    const merged = mergeDuplicateItems([
      plan("株式会社Widsley 面接"),
      plan("株式会社Widsley 一次面接", { startTime: "12:15", endTime: "12:45", location: "オンライン(Google Meet)" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("株式会社Widsley 一次面接");
    expect(merged[0].startTime).toBe("12:15");
    expect(merged[0].location).toBe("オンライン(Google Meet)");
  });

  it("日程調整の候補日時(同じ日で時刻が違う)は、まとめない", () => {
    const merged = mergeDuplicateItems([
      plan("一次面接 候補", { startTime: "10:00" }),
      plan("一次面接 候補", { startTime: "14:00" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("日付が違えばまとめない", () => {
    const merged = mergeDuplicateItems([plan("一次面接"), { ...plan("一次面接"), date: "2026-09-04" }]);
    expect(merged).toHaveLength(2);
  });

  it("別の用件はまとめない", () => {
    const merged = mergeDuplicateItems([plan("株式会社A 説明会"), plan("株式会社B 一次面接")]);
    expect(merged).toHaveLength(2);
  });

  it("種類が読み取れている方を残す", () => {
    const merged = mergeDuplicateItems([
      { date: "2026-09-03", title: "羽田→福岡", type: "other" as const },
      { date: "2026-09-03", title: "羽田→福岡 JAL123", type: "transport" as const, startTime: "09:00" },
    ]);
    expect(merged[0].type).toBe("transport");
    expect(merged[0].title).toBe("羽田→福岡 JAL123");
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
  withExpense: false,
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
    const record = toCalendarEventRecord(row({ startTime: "08:20", endTime: "10:15" }), 1_000);
    expect(record.allDay).toBe(false);
    expect(record.startTime).toBe("08:20");
    expect(record.endTime).toBe("10:15");
  });

  it("旅行の日程にも終了時刻(到着時刻)を持たせる", () => {
    const record = toTripScheduleRecord(row({ startTime: "10:05", endTime: "13:20" }), "trip-1", 1_000);
    expect(record.startTime).toBe("10:05");
    expect(record.endTime).toBe("13:20");
  });

  it("終日の予定には終了時刻を残さない", () => {
    // 時刻の無い予定に「〜13:20」とだけ出ると読めない。
    const record = toCalendarEventRecord(row({ endTime: "13:20" }), 1_000);
    expect(record.allDay).toBe(true);
    expect(record.endTime).toBeUndefined();
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

describe("旅行の費用への積み方", () => {
  it("金額と日付をそのまま費用にし、支払い済みとして置く", () => {
    // 予約確認メールに金額が書かれている時点で、たいてい支払いは済んでいる。
    const record = toTripExpenseRecord(row({ amount: 12540, withExpense: true }), "trip-1", 1_000);
    expect(record).toEqual({
      tripId: "trip-1",
      title: "羽田→福岡",
      amount: 12540,
      category: "transport",
      paidDate: "2026-09-12",
      paid: true,
      memo: undefined,
      createdAt: 1_000,
    });
  });

  it("日程の種類を費用の分類に読み替える", () => {
    expect(toExpenseCategory("transport")).toBe("transport");
    expect(toExpenseCategory("lodging")).toBe("lodging");
    expect(toExpenseCategory("meal")).toBe("meal");
    expect(toExpenseCategory("sightseeing")).toBe("sightseeing");
    expect(toExpenseCategory("other")).toBe("other");
  });
});

describe("二重登録の判定", () => {
  it("日付・時刻・タイトルが揃っていれば同じものとみなす", () => {
    const keys = new Set([planKey("2026-09-19", "10:05", "のぞみ124号")]);
    expect(isAlreadyRegistered(row({ date: "2026-09-19", startTime: "10:05", title: "のぞみ124号" }), keys)).toBe(true);
  });

  it("タイトルの前後の空白は無視する", () => {
    // 見た目が同じものを、空白1つで別物と判定してしまわないようにする。
    const keys = new Set([planKey("2026-09-19", "10:05", "のぞみ124号")]);
    expect(isAlreadyRegistered(row({ date: "2026-09-19", startTime: "10:05", title: " のぞみ124号 " }), keys)).toBe(true);
  });

  it("時刻が違えば別のものとして扱う", () => {
    const keys = new Set([planKey("2026-09-19", "10:05", "のぞみ124号")]);
    expect(isAlreadyRegistered(row({ date: "2026-09-19", startTime: "14:05", title: "のぞみ124号" }), keys)).toBe(false);
  });

  it("日付が違えば別のものとして扱う", () => {
    const keys = new Set([planKey("2026-09-19", "10:05", "のぞみ124号")]);
    expect(isAlreadyRegistered(row({ date: "2026-09-26", startTime: "10:05", title: "のぞみ124号" }), keys)).toBe(false);
  });

  it("時刻なしどうしも揃う", () => {
    const keys = new Set([planKey("2026-09-19", undefined, "ホテル泊")]);
    expect(isAlreadyRegistered(row({ date: "2026-09-19", startTime: undefined, title: "ホテル泊" }), keys)).toBe(true);
  });

  it("まだ読み込めていない時は、重複扱いにしない", () => {
    // 判定できないうちに「登録済み」と出すと、入れられるものを入れられなくする。
    expect(isAlreadyRegistered(row({ title: "のぞみ124号" }), undefined)).toBe(false);
  });
});

describe("ルートへの起こし方", () => {
  const shinkansen = {
    date: "2026-09-19",
    startTime: "10:05",
    title: "東京→新函館北斗 はやぶさ13号",
    location: "東京駅",
    endLocation: "新函館北斗駅",
    type: "transport" as const,
  };

  it("移動は、出発地と到着地の2地点に分ける", () => {
    // 「東京→新函館北斗 はやぶさ13号」は区間の名前で、地図に置ける場所ではない。
    const rows = toRouteImportRows([shinkansen]);
    expect(rows.map((r) => ({ name: r.name, address: r.address }))).toEqual([
      { name: "東京駅", address: "東京駅" },
      { name: "新函館北斗駅", address: "新函館北斗駅" },
    ]);
    // どの移動から来た場所かが分かるように、区間名はメモに残す。
    expect(rows[0].memo).toBe("東京→新函館北斗 はやぶさ13号");
    expect(rows.every((r) => r.checked)).toBe(true);
  });

  it("往復でも、同じ駅は1件にまとめる", () => {
    const rows = toRouteImportRows([
      shinkansen,
      {
        date: "2026-09-21",
        title: "新函館北斗→東京 はやぶさ34号",
        location: "新函館北斗駅",
        endLocation: "東京駅",
        type: "transport" as const,
      },
    ]);
    expect(rows.map((r) => r.address)).toEqual(["東京駅", "新函館北斗駅"]);
  });

  it("到着地が読み取れない移動は、出発地だけ起こす", () => {
    // 古いサーバーは endLocation を返さない。
    const rows = toRouteImportRows([{ ...shinkansen, endLocation: undefined }]);
    expect(rows.map((r) => r.address)).toEqual(["東京駅"]);
  });

  it("宿や観光は、日程のタイトルを名前・場所を住所にする", () => {
    // 日程の場所をつついてルートに起こす時(TripDetailPage)と同じ組み合わせ。
    const rows = toRouteImportRows([
      { date: "2026-09-19", title: "ホテルにチェックイン", location: "函館市若松町9-19", type: "lodging" as const },
    ]);
    expect(rows).toEqual([
      { checked: true, name: "ホテルにチェックイン", address: "函館市若松町9-19", memo: undefined, date: "2026-09-19" },
    ]);
  });

  it("場所が読み取れていない項目は、ルートには起こさない", () => {
    // 住所が空だと地図が行き先ごと迷子になる。
    expect(toRouteImportRows([{ date: "2026-09-19", title: "何かの予約", type: "other" as const }])).toEqual([]);
  });

  it("ルートの場所は、いま入っている場所の後ろに順に足す", () => {
    const rows = toRouteImportRows([shinkansen]);
    const start = nextRouteSortOrder([{ sortOrder: 1 }, { sortOrder: 3 }]);
    expect(start).toBe(4);
    expect(toTripRoutePlaceRecord(rows[0], "trip-1", start, 1_000)).toEqual({
      tripId: "trip-1",
      name: "東京駅",
      address: "東京駅",
      sortOrder: 4,
      // メールの日程の日付をそのまま持ち越す(ルート画面の日にち切り替えで使う)。
      date: "2026-09-19",
      memo: "東京→新函館北斗 はやぶさ13号",
      visited: false,
      createdAt: 1_000,
    });
  });

  it("1件も入っていなければ、最初の順番は1", () => {
    expect(nextRouteSortOrder([])).toBe(1);
  });
});

describe("ルートの二重登録の判定", () => {
  const place = { checked: true, name: "東京駅", address: "東京駅" };

  it("同じ場所が既にルートにあれば、入れられなくする", () => {
    expect(isRouteAlreadyRegistered(place, new Set([routeKey("東京駅")]))).toBe(true);
  });

  it("前後の空白は無視する", () => {
    expect(isRouteAlreadyRegistered({ ...place, address: " 東京駅 " }, new Set([routeKey("東京駅")]))).toBe(true);
  });

  it("違う場所は入れられる", () => {
    expect(isRouteAlreadyRegistered(place, new Set([routeKey("新函館北斗駅")]))).toBe(false);
  });

  it("まだ読み込めていない時は、重複扱いにしない", () => {
    expect(isRouteAlreadyRegistered(place, undefined)).toBe(false);
  });
});

describe("入れ先の旅行が要るか", () => {
  it("旅行の日程とルートは旅行が要る", () => {
    expect(needsTrip("trip")).toBe(true);
    expect(needsTrip("route")).toBe(true);
  });

  it("予定とタスクは、旅行が無くても入れられる", () => {
    expect(needsTrip("event")).toBe(false);
    expect(needsTrip("task")).toBe(false);
  });
});

describe("上段のタブと入れ先", () => {
  it("上段は旅行計画・予定・タスクの3つ", () => {
    expect(PLAN_GROUPS.map((g) => g.label)).toEqual(["旅行計画", "予定", "タスク"]);
  });

  it("旅行計画は、中で選んだ日程かルートが入れ先になる", () => {
    expect(toDestination("trip", "trip")).toBe("trip");
    expect(toDestination("trip", "route")).toBe("route");
  });

  it("予定・タスクは、中の選択に関わらずそのまま", () => {
    // 旅行計画の中でルートを見ていた状態から予定へ移っても、予定に入る。
    expect(toDestination("event", "route")).toBe("event");
    expect(toDestination("task", "route")).toBe("task");
  });
});

describe("まとめて入れる時の並びと文言", () => {
  it("入れ先の並びは、タブと同じ順に揃える", () => {
    // 保存の順も画面の内訳もこの順。選んだ順に左右されないようにする。
    expect(sortDestinations(["task", "route", "trip"])).toEqual(["trip", "route", "task"]);
  });

  it("「ほかにも入れる」には、いま開いている入れ先を出さない", () => {
    expect(otherDestinations("trip")).toEqual(["route", "event", "task"]);
    expect(otherDestinations("event")).toEqual(["trip", "route", "task"]);
  });

  it("入れる前に、どこに何件入るかを出す", () => {
    expect(
      describeCounts([
        { destination: "trip", count: 2 },
        { destination: "event", count: 1 },
      ]),
    ).toBe("旅行の日程 2件・予定 1件");
  });

  it("0件の入れ先は内訳に書かない", () => {
    // 「予定 0件」と出ると、入るのか入らないのか読めない。
    expect(
      describeCounts([
        { destination: "trip", count: 2 },
        { destination: "event", count: 0 },
      ]),
    ).toBe("旅行の日程 2件");
  });

  it("入れ終わったら、どこに何件入れたかを知らせる", () => {
    expect(
      describeSaved([
        { destination: "trip", count: 2 },
        { destination: "event", count: 1 },
      ]),
    ).toBe("旅行の日程に2件、予定に1件入れました");
  });

  it("1か所だけなら、そのまま1つぶんの文にする", () => {
    expect(describeSaved([{ destination: "task", count: 3 }])).toBe("タスクに3件入れました");
  });
});


describe("同じ日の似た予定を見つける", () => {
  // しおりのような時刻の無い文章は、読み取るたびに書き方が少し変わる。日付・時刻・
  // タイトルが揃った時だけ弾く planKey では、同じ予定が二重に並んでしまう。
  const existing = [
    { date: "2026-09-19", title: "鎌倉散歩" },
    { date: "2026-09-20", title: "🎣 初心者船釣り", startTime: "07:00" },
    { date: "2026-09-24", title: "移動" },
  ];

  it("絵文字・記号・空白のゆれは同じものとみなす", () => {
    expect(normalizePlanTitle("🎣 初心者船釣り")).toBe(normalizePlanTitle("初心者船釣り"));
    expect(normalizePlanTitle("えのすい・江の島灯籠")).toBe(normalizePlanTitle("えのすい 江の島灯籠"));
    expect(findSimilarPlan({ date: "2026-09-20", title: "初心者船釣り" }, existing)).toBe("🎣 初心者船釣り");
  });

  it("片方がもう片方を含む書き方も、同じ予定とみなす", () => {
    expect(findSimilarPlan({ date: "2026-09-19", title: "お迎え・買い出し・鎌倉散歩" }, existing)).toBe("鎌倉散歩");
  });

  it("日が違えば別の予定", () => {
    // 同じ場所へ2日続けて行くこともある。
    expect(findSimilarPlan({ date: "2026-09-26", title: "鎌倉散歩" }, existing)).toBeUndefined();
  });

  it("短い言葉は、含むだけでは同じとみなさない", () => {
    // 「移動」はどの予定にも出てくる。ここで弾くと、入れたい予定まで外れてしまう。
    expect(findSimilarPlan({ date: "2026-09-24", title: "横浜へ移動して中華街" }, existing)).toBeUndefined();
    expect(findSimilarPlan({ date: "2026-09-24", title: "移動" }, existing)).toBe("移動");
  });

  it("いま入っている日程がまだ読めていない時は、何も言わない", () => {
    expect(findSimilarPlan({ date: "2026-09-19", title: "鎌倉散歩" }, undefined)).toBeUndefined();
  });
});
