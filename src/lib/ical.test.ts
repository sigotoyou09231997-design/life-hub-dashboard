import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../types";
import { buildCalendarIcs, buildVevent, calendarIcsFilename, foldIcsLine, icsEscape, icsStamp } from "./ical";

const STAMP = "20260830T101500Z";

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return { id: "e1", title: "打ち合わせ", date: "2026-08-30", createdAt: 0, ...overrides };
}

function lines(e: CalendarEvent): string[] {
  return buildVevent(e, STAMP, "fallback");
}

describe("icsEscape", () => {
  it("バックスラッシュ・セミコロン・カンマ・改行を逃がす", () => {
    expect(icsEscape("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(icsEscape("1行目\n2行目")).toBe("1行目\\n2行目");
    expect(icsEscape("CRLF\r\nも1つ")).toBe("CRLF\\nも1つ");
  });

  it("逃がした後の記号を二重に逃がさない", () => {
    // バックスラッシュを後回しにすると "\," が "\\," になって崩れる。
    expect(icsEscape("\\")).toBe("\\\\");
  });
});

describe("foldIcsLine", () => {
  it("75オクテットまでは折り返さない", () => {
    const line = "SUMMARY:" + "a".repeat(67);
    expect(foldIcsLine(line)).toBe(line);
    expect(line.length).toBe(75);
  });

  it("超えた分は改行＋空白1つで続ける", () => {
    const folded = foldIcsLine("SUMMARY:" + "a".repeat(100));
    expect(folded).toContain("\r\n ");
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it("日本語は文字の途中で切らない", () => {
    const folded = foldIcsLine("SUMMARY:" + "あ".repeat(60));
    // 3オクテットの文字を割ると化ける。復元して元に戻ることで確かめる。
    expect(folded.split("\r\n ").join("")).toBe("SUMMARY:" + "あ".repeat(60));
  });
});

describe("icsStamp", () => {
  it("DTSTAMPはUTCで書く", () => {
    expect(icsStamp(Date.UTC(2026, 7, 30, 10, 15, 0))).toBe("20260830T101500Z");
  });
});

describe("buildVevent", () => {
  it("時刻付きの予定は浮動時間(TZIDもZも付けない)で書く", () => {
    const out = lines(event({ startTime: "10:00", endTime: "11:30" }));
    expect(out).toContain("DTSTART:20260830T100000");
    expect(out).toContain("DTEND:20260830T113000");
    expect(out.join("\n")).not.toContain("TZID");
  });

  it("終了時刻が無ければ1時間の予定にする", () => {
    // 長さ0の予定は、取り込んだ先のカレンダーで線1本になって読めない。
    expect(lines(event({ startTime: "23:30" }))).toContain("DTEND:20260831T003000");
  });

  it("終了時刻が開始より前なら1時間後に直す", () => {
    expect(lines(event({ startTime: "10:00", endTime: "09:00" }))).toContain("DTEND:20260830T110000");
  });

  it("何日かにまたがる時刻付きの予定は、終了日の時刻で終わる", () => {
    const out = lines(event({ startTime: "15:00", endDate: "2026-09-01", endTime: "10:00" }));
    expect(out).toContain("DTSTART:20260830T150000");
    expect(out).toContain("DTEND:20260901T100000");
  });

  it("終了日だけあって終了時刻が無いときは、終了日の開始時刻で終わる", () => {
    expect(lines(event({ startTime: "15:00", endDate: "2026-09-01" }))).toContain("DTEND:20260901T150000");
  });

  it("終日の予定はDATE型で、DTENDは翌日(その日を含まない)", () => {
    const out = lines(event({ allDay: true }));
    expect(out).toContain("DTSTART;VALUE=DATE:20260830");
    expect(out).toContain("DTEND;VALUE=DATE:20260831");
  });

  it("月をまたぐ終日の予定でも翌日を正しく出す", () => {
    const out = lines(event({ allDay: true, endDate: "2026-08-31" }));
    expect(out).toContain("DTEND;VALUE=DATE:20260901");
  });

  it("開始時刻が無い予定は終日として書く", () => {
    // 00:00 を付けると「深夜0時の予定」に化ける。
    expect(lines(event({}))).toContain("DTSTART;VALUE=DATE:20260830");
  });

  it("繰り返しはRRULEにする(終了日はDTSTARTと同じ形で書く)", () => {
    expect(lines(event({ startTime: "10:00", repeat: "weekly" }))).toContain("RRULE:FREQ=WEEKLY");
    expect(lines(event({ startTime: "10:00", repeat: "daily", repeatUntil: "2026-12-31" }))).toContain(
      "RRULE:FREQ=DAILY;UNTIL=20261231T235959",
    );
    expect(lines(event({ allDay: true, repeat: "monthly", repeatUntil: "2026-12-31" }))).toContain(
      "RRULE:FREQ=MONTHLY;UNTIL=20261231",
    );
  });

  it("繰り返さない予定にはRRULEを付けない", () => {
    expect(lines(event({ repeat: "none" })).join("\n")).not.toContain("RRULE");
  });

  it("場所・メモは書かれているときだけ入れる", () => {
    expect(lines(event({})).join("\n")).not.toContain("LOCATION");
    const out = lines(event({ location: "東京駅", memo: "資料を持参" }));
    expect(out).toContain("LOCATION:東京駅");
    expect(out).toContain("DESCRIPTION:資料を持参");
  });

  it("idが無い予定にも一意なUIDを付ける", () => {
    expect(buildVevent(event({ id: undefined }), STAMP, "life-hub-3")).toContain("UID:life-hub-3@life-hub");
  });
});

describe("buildCalendarIcs", () => {
  const ics = buildCalendarIcs(
    [event({ id: "b", date: "2026-09-02", title: "後の予定" }), event({ id: "a", title: "先の予定" })],
    Date.UTC(2026, 7, 30, 10, 15, 0),
  );

  it("VCALENDARで包み、CRLFで終わる", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("日付の古い順に並べる", () => {
    expect(ics.indexOf("先の予定")).toBeLessThan(ics.indexOf("後の予定"));
  });

  it("予定が0件でも壊れないカレンダーにする", () => {
    const empty = buildCalendarIcs([], 0);
    expect(empty).toContain("BEGIN:VCALENDAR");
    expect(empty).not.toContain("BEGIN:VEVENT");
  });
});

describe("calendarIcsFilename", () => {
  it("書き出した日を名前に入れる", () => {
    expect(calendarIcsFilename("2026-08-30")).toBe("life-hub-events-2026-08-30.ics");
  });
});
