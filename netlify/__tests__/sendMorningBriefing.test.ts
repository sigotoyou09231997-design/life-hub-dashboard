import { describe, expect, it } from "vitest";
import { occursOn, type DateSpan } from "../../src/lib/eventSpan";
import {
  buildMorningBriefingPayload,
  jstTodayStr,
  occurrenceStartOn,
  todaysEvents,
  type BriefingEventRow,
  type EventSpan,
} from "../functions/sendMorningBriefing";

function row(overrides: Partial<BriefingEventRow>): BriefingEventRow {
  return {
    title: "予定",
    date: "2026-09-16",
    end_date: null,
    start_time: null,
    all_day: false,
    repeat: null,
    repeat_until: null,
    ...overrides,
  };
}

describe("画面側(src/lib/eventSpan.ts)とのずれ", () => {
  // 関数は src/ を import できないので、繰り返しの判定を写してある。食い違うと
  // 「ホームには出ているのに朝の通知では予定なし」になるので、同じ入力で突き合わせる。
  const spans: EventSpan[] = [
    { date: "2026-09-16" },
    { date: "2026-09-14", endDate: "2026-09-17" },
    { date: "2026-09-16", endDate: "2026-09-15" },
    { date: "2026-09-01", repeat: "daily" },
    { date: "2026-09-01", repeat: "daily", repeatUntil: "2026-09-10" },
    { date: "2026-09-20", repeat: "daily" },
    { date: "2026-09-02", repeat: "weekly" },
    { date: "2026-09-01", endDate: "2026-09-02", repeat: "weekly" },
    { date: "2026-01-31", repeat: "monthly" },
    { date: "2026-03-30", endDate: "2026-04-01", repeat: "monthly" },
    { date: "2026-09-01", repeat: "weekdays:1,3,5" },
    { date: "2026-09-01", repeat: "weekdays:" },
    { date: "2026-09-01", repeat: "none" },
    { date: "2024-06-01", repeat: "weekly" },
  ];
  const dates: string[] = [];
  for (let t = Date.UTC(2026, 0, 25); t <= Date.UTC(2026, 9, 10); t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }

  for (const span of spans) {
    it(`${JSON.stringify(span)} がかかる日が、画面と同じ`, () => {
      const mismatches = dates.filter(
        (date) => (occurrenceStartOn(span, date) !== undefined) !== occursOn(span as DateSpan, date),
      );
      expect(mismatches).toEqual([]);
    });
  }
});

describe("todaysEvents", () => {
  it("今日かかる予定だけを、時刻の無いもの→早い順に並べる", () => {
    const events = todaysEvents(
      [
        row({ title: "午後の打ち合わせ", start_time: "15:00" }),
        row({ title: "明日の予定", date: "2026-09-17" }),
        row({ title: "歯医者", start_time: "10:00:00" }),
        row({ title: "誕生日", all_day: true }),
        row({ title: "ジム", date: "2026-09-02", repeat: "weekly", start_time: "07:30" }),
      ],
      "2026-09-16",
    );
    expect(events).toEqual([
      { title: "誕生日", time: undefined },
      { title: "ジム", time: "07:30" },
      { title: "歯医者", time: "10:00" },
      { title: "午後の打ち合わせ", time: "15:00" },
    ]);
  });

  it("何日かにまたがる予定の2日目以降は、開始時刻を持たせない(毎朝「10:00〜」と出さない)", () => {
    const events = todaysEvents(
      [row({ title: "京都の宿", date: "2026-09-15", end_date: "2026-09-17", start_time: "15:00" })],
      "2026-09-16",
    );
    expect(events).toEqual([{ title: "京都の宿", time: undefined }]);
  });
});

describe("buildMorningBriefingPayload", () => {
  const parse = (payload: string) => JSON.parse(payload) as { title: string; body: string; url: string };

  it("予定の数と最初の予定、重要な未読を一言にまとめる", () => {
    const payload = parse(
      buildMorningBriefingPayload(
        "2026-09-16",
        [{ title: "誕生日" }, { title: "歯医者", time: "10:00" }, { title: "会議", time: "15:00" }],
        2,
      ),
    );
    expect(payload).toEqual({
      title: "今日のまとめ（9/16）",
      body: "予定3件（最初は10:00 歯医者）・重要な未読メール2件",
      url: "/",
    });
  });

  it("時刻つきの予定が無ければ、先頭の予定の名前を出す", () => {
    expect(parse(buildMorningBriefingPayload("2026-09-16", [{ title: "誕生日" }], 0)).body).toBe("予定1件（誕生日）");
  });

  it("予定が無い日も送る(届かないと、止まったのか予定が無いのか分からない)", () => {
    expect(parse(buildMorningBriefingPayload("2026-09-16", [], 0)).body).toBe("今日の予定はありません");
  });
});

describe("jstTodayStr", () => {
  it("UTC 22:00(実行する時刻)は、JST では翌日の7時", () => {
    expect(jstTodayStr(Date.UTC(2026, 8, 15, 22, 0))).toBe("2026-09-16");
  });
});
