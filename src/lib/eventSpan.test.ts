import { describe, expect, it } from "vitest";
import {
  collectSpanDates,
  isMultiDay,
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
