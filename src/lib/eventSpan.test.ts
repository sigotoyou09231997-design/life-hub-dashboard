import { describe, expect, it } from "vitest";
import {
  collectSpanDates,
  collectSpanDatesInRange,
  isMultiDay,
  nextOccurrenceOnOrAfter,
  normalizeEndDate,
  occurringOn,
  occursOn,
  overlapsRange,
  spanDates,
  spanDayIndex,
  spanDays,
  spanEndDate,
  spanLabel,
  spanTimeText,
} from "./eventSpan";

const oneDay = { date: "2026-09-27" };
const stay = { date: "2026-09-27", endDate: "2026-09-29" };

describe("spanEndDate", () => {
  it("終了日が無ければ開始日を最終日にする", () => {
    expect(spanEndDate(oneDay)).toBe("2026-09-27");
  });

  it("開始日より前の終了日は無視する(古い行や壊れた入力で初日が消えないように)", () => {
    expect(spanEndDate({ date: "2026-09-27", endDate: "2026-09-20" })).toBe("2026-09-27");
    expect(spanEndDate({ date: "2026-09-27", endDate: "こわれている" })).toBe("2026-09-27");
  });
});

describe("normalizeEndDate", () => {
  it("開始日と同じ日・前の日・空欄は持たせない", () => {
    expect(normalizeEndDate("2026-09-27", "2026-09-27")).toBeUndefined();
    expect(normalizeEndDate("2026-09-27", "2026-09-26")).toBeUndefined();
    expect(normalizeEndDate("2026-09-27", "")).toBeUndefined();
    expect(normalizeEndDate("2026-09-27", undefined)).toBeUndefined();
  });

  it("開始日より後ならそのまま持たせる", () => {
    expect(normalizeEndDate("2026-09-27", "2026-09-29")).toBe("2026-09-29");
  });
});

describe("spanDays / isMultiDay", () => {
  it("1日で終わるものは1日", () => {
    expect(spanDays(oneDay)).toBe(1);
    expect(isMultiDay(oneDay)).toBe(false);
  });

  it("27日から29日までは3日", () => {
    expect(spanDays(stay)).toBe(3);
    expect(isMultiDay(stay)).toBe(true);
  });

  it("月をまたいでも日数が合う", () => {
    expect(spanDays({ date: "2026-09-29", endDate: "2026-10-02" })).toBe(4);
  });
});

describe("occursOn", () => {
  it("初日・途中・最終日はかかっている", () => {
    expect(occursOn(stay, "2026-09-27")).toBe(true);
    expect(occursOn(stay, "2026-09-28")).toBe(true);
    expect(occursOn(stay, "2026-09-29")).toBe(true);
  });

  it("前後の日はかかっていない", () => {
    expect(occursOn(stay, "2026-09-26")).toBe(false);
    expect(occursOn(stay, "2026-09-30")).toBe(false);
  });

  it("終了日の無い予定は今までどおりその日だけ", () => {
    expect(occursOn(oneDay, "2026-09-27")).toBe(true);
    expect(occursOn(oneDay, "2026-09-28")).toBe(false);
  });
});

describe("spanDates / spanDayIndex", () => {
  it("かかっている日を全部返す", () => {
    expect(spanDates(stay)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29"]);
    expect(spanDates(oneDay)).toEqual(["2026-09-27"]);
  });

  it("何日目かを1から数える", () => {
    expect(spanDayIndex(stay, "2026-09-27")).toBe(1);
    expect(spanDayIndex(stay, "2026-09-29")).toBe(3);
    expect(spanDayIndex(stay, "2026-09-30")).toBe(0);
  });
});

describe("spanLabel", () => {
  it("1日で終わるものには何も出さない", () => {
    expect(spanLabel(oneDay)).toBe("");
    expect(spanLabel(oneDay, "2026-09-27")).toBe("");
  });

  it("その日を見ている画面では何日目かを出す", () => {
    expect(spanLabel(stay, "2026-09-28")).toBe("2日目/3日");
  });

  it("日をまたいで並べる画面では期間そのものを出す", () => {
    expect(spanLabel(stay)).toBe("9/27(日)〜9/29(火)");
    expect(spanLabel(stay, "2026-10-05")).toBe("9/27(日)〜9/29(火)");
  });
});

describe("overlapsRange", () => {
  it("期間の外から中へ食い込んでいる予定も拾う", () => {
    expect(overlapsRange(stay, "2026-09-28", "2026-10-10")).toBe(true);
    expect(overlapsRange(stay, "2026-09-01", "2026-09-27")).toBe(true);
  });

  it("まったく重ならなければ拾わない", () => {
    expect(overlapsRange(stay, "2026-09-30", "2026-10-10")).toBe(false);
  });
});

describe("occurringOn / collectSpanDates", () => {
  const items = [stay, oneDay, { date: "2026-10-01" }];

  it("その日にかかっている分だけ残す", () => {
    expect(occurringOn(items, "2026-09-28")).toEqual([stay]);
    expect(occurringOn(items, "2026-09-27")).toEqual([stay, oneDay]);
  });

  it("点を打つ日付は、またがる日をすべて含む", () => {
    expect([...collectSpanDates(items)].sort()).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-10-01",
    ]);
  });
});

describe("spanTimeText", () => {
  const trip = { date: "2026-09-27", endDate: "2026-09-29", startTime: "10:00", endTime: "13:00" };

  it("1日で終わる予定は今までどおりの出方", () => {
    expect(spanTimeText({ date: "2026-09-27", startTime: "10:00", endTime: "13:00" })).toBe("10:00〜13:00");
    expect(spanTimeText({ date: "2026-09-27", startTime: "10:00" })).toBe("10:00");
    expect(spanTimeText({ date: "2026-09-27" })).toBe("時刻未設定");
    expect(spanTimeText({ date: "2026-09-27", allDay: true })).toBe("終日");
  });

  it("その日を見ている画面では、初日は開始だけ・最終日は終了だけを出す", () => {
    expect(spanTimeText(trip, "2026-09-27")).toBe("10:00〜");
    expect(spanTimeText(trip, "2026-09-29")).toBe("〜13:00");
  });

  it("間の日は丸一日として見せる(毎日10時に何かある、と読ませない)", () => {
    expect(spanTimeText(trip, "2026-09-28")).toBe("終日");
  });

  it("日をまたいで並べる画面では期間の時刻をそのまま出す", () => {
    expect(spanTimeText(trip)).toBe("10:00〜13:00");
  });

  it("時刻の無いまたがる予定は、時刻未設定ではなく終日", () => {
    expect(spanTimeText({ date: "2026-09-27", endDate: "2026-09-29" })).toBe("終日");
  });
});

describe("occursOn / spanDayIndex — 繰り返し", () => {
  it("毎日: 開始日より後はずっとかかっている", () => {
    const event = { date: "2026-09-27", repeat: "daily" as const };
    expect(occursOn(event, "2026-09-28")).toBe(true);
    expect(occursOn(event, "2026-10-15")).toBe(true);
    expect(occursOn(event, "2026-09-26")).toBe(false);
  });

  it("毎週: 7日おきの同じ曜日だけかかっている", () => {
    const event = { date: "2026-09-27", repeat: "weekly" as const };
    expect(occursOn(event, "2026-10-04")).toBe(true);
    expect(occursOn(event, "2026-10-11")).toBe(true);
    expect(occursOn(event, "2026-10-01")).toBe(false);
    expect(occursOn(event, "2026-10-05")).toBe(false);
  });

  it("毎週・複数日にまたがる予定は、各回とも同じ日数ぶんかかる", () => {
    const event = { date: "2026-09-27", endDate: "2026-09-28", repeat: "weekly" as const };
    expect(occursOn(event, "2026-10-04")).toBe(true);
    expect(occursOn(event, "2026-10-05")).toBe(true);
    expect(occursOn(event, "2026-10-06")).toBe(false);
    expect(spanDayIndex(event, "2026-10-05")).toBe(2);
  });

  it("毎月: 同じ日(短い月は月末に寄る)で繰り返す", () => {
    const event = { date: "2026-01-31", repeat: "monthly" as const };
    expect(occursOn(event, "2026-02-28")).toBe(true); // 2月は31日が無いので月末
    expect(occursOn(event, "2026-03-31")).toBe(true);
    expect(occursOn(event, "2026-02-27")).toBe(false);
  });

  it("繰り返しの回では、その回の開始日を基準に何日目かを数え直す", () => {
    const event = { date: "2026-09-27", repeat: "weekly" as const };
    expect(spanDayIndex(event, "2026-10-04")).toBe(1);
  });

  it("repeatUntilを過ぎたら繰り返さない", () => {
    const event = { date: "2026-09-27", repeat: "weekly" as const, repeatUntil: "2026-10-04" };
    expect(occursOn(event, "2026-10-04")).toBe(true);
    expect(occursOn(event, "2026-10-11")).toBe(false);
  });

  it("repeatが無い・noneなら今までどおり繰り返さない", () => {
    expect(occursOn({ date: "2026-09-27", repeat: "none" as const }, "2026-10-04")).toBe(false);
    expect(occursOn(oneDay, "2026-10-04")).toBe(false);
  });
});

describe("nextOccurrenceOnOrAfter", () => {
  it("繰り返しの元の開始日がとっくに過ぎていても、次の回の日付を返す", () => {
    const event = { date: "2026-01-05", repeat: "weekly" as const };
    expect(nextOccurrenceOnOrAfter(event, "2026-09-27")).toBe("2026-09-28");
  });

  it("いま丁度かかっていればその日をそのまま返す", () => {
    expect(nextOccurrenceOnOrAfter(stay, "2026-09-28")).toBe("2026-09-28");
  });

  it("繰り返しでない予定が既に終わっていれば見つからない", () => {
    expect(nextOccurrenceOnOrAfter(oneDay, "2026-10-01")).toBeUndefined();
  });
});

describe("collectSpanDatesInRange", () => {
  it("範囲内に収まる繰り返しの回だけ点を打つ", () => {
    const event = { date: "2026-09-27", repeat: "weekly" as const };
    const dates = collectSpanDatesInRange([event], "2026-09-01", "2026-09-30");
    expect(dates).toEqual(new Set(["2026-09-27"]));

    const nextMonth = collectSpanDatesInRange([event], "2026-10-01", "2026-10-31");
    expect(nextMonth).toEqual(new Set(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]));
  });
});

describe("曜日指定の繰り返し", () => {
  // 2026-09-07 は月曜。"weekdays:1,3,5" = 月・水・金。
  const monWedFri = { date: "2026-09-07", repeat: "weekdays:1,3,5" as const };

  it("選んだ曜日の日にだけかかる", () => {
    expect(occursOn(monWedFri, "2026-09-09")).toBe(true); // 水
    expect(occursOn(monWedFri, "2026-09-11")).toBe(true); // 金
    expect(occursOn(monWedFri, "2026-09-14")).toBe(true); // 翌週の月
    expect(occursOn(monWedFri, "2026-09-10")).toBe(false); // 木
    expect(occursOn(monWedFri, "2026-09-13")).toBe(false); // 日
  });

  it("開始日より前は、曜日が合っていても埋めない", () => {
    expect(occursOn(monWedFri, "2026-09-04")).toBe(false); // 直前の金曜
  });

  it("繰り返しの終了日を過ぎたら止まる", () => {
    const until = { ...monWedFri, repeatUntil: "2026-09-11" };
    expect(occursOn(until, "2026-09-11")).toBe(true);
    expect(occursOn(until, "2026-09-14")).toBe(false);
  });

  it("その回は1日ぶんとして数える(何日目かは常に1)", () => {
    expect(spanDayIndex(monWedFri, "2026-09-09")).toBe(1);
  });

  it("曜日が1つも読めない指定は、繰り返さない単発として扱う", () => {
    const broken = { date: "2026-09-07", repeat: "weekdays:" as never };
    expect(occursOn(broken, "2026-09-14")).toBe(false);
    expect(occursOn(broken, "2026-09-07")).toBe(true);
  });

  it("次の回を探すときも曜日を守る", () => {
    expect(nextOccurrenceOnOrAfter(monWedFri, "2026-09-10")).toBe("2026-09-11");
  });

  it("カレンダーの点も、その月の該当曜日にだけ打つ", () => {
    const dates = collectSpanDatesInRange([monWedFri], "2026-09-07", "2026-09-20");
    expect(dates).toEqual(
      new Set(["2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14", "2026-09-16", "2026-09-18"]),
    );
  });
});
