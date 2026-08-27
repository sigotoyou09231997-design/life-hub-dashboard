import { describe, expect, it } from "vitest";
import {
  buildEventReminderPayload,
  buildFixedCostReminderPayload,
  buildTaskReminderPayload,
  fixedCostReminderMonth,
  isTimedReminderDue,
  jstYearMonth,
} from "../functions/checkRemindersAndNotify";

function jstMs(iso: string): number {
  // "2026-09-27T09:55" のようなJSTの壁時計表記からepoch msを作るテスト用ヘルパー。
  return new Date(`${iso}:00+09:00`).getTime();
}

describe("isTimedReminderDue", () => {
  const base = { date: "2026-09-27", time: "10:00", allDay: false, notifyMinutesBefore: 10, notifiedAt: null };

  it("通知タイミングの少し前ではまだ通知しない", () => {
    expect(isTimedReminderDue(base, jstMs("2026-09-27T09:45"))).toBe(false);
  });

  it("通知タイミングに入ると通知する", () => {
    expect(isTimedReminderDue(base, jstMs("2026-09-27T09:50"))).toBe(true);
    expect(isTimedReminderDue(base, jstMs("2026-09-27T09:55"))).toBe(true);
  });

  it("予定の時刻から猶予(30分)を過ぎたらもう通知しない", () => {
    expect(isTimedReminderDue(base, jstMs("2026-09-27T10:20"))).toBe(true);
    expect(isTimedReminderDue(base, jstMs("2026-09-27T10:40"))).toBe(false);
  });

  it("既に通知済み・終日・通知設定なしのいずれかなら通知しない", () => {
    expect(isTimedReminderDue({ ...base, notifiedAt: Date.now() }, jstMs("2026-09-27T09:55"))).toBe(false);
    expect(isTimedReminderDue({ ...base, allDay: true }, jstMs("2026-09-27T09:55"))).toBe(false);
    expect(isTimedReminderDue({ ...base, notifyMinutesBefore: null }, jstMs("2026-09-27T09:55"))).toBe(false);
  });

  it("日付・時刻が無ければ通知しない", () => {
    expect(isTimedReminderDue({ ...base, date: null }, jstMs("2026-09-27T09:55"))).toBe(false);
    expect(isTimedReminderDue({ ...base, time: null }, jstMs("2026-09-27T09:55"))).toBe(false);
  });
});

describe("jstYearMonth", () => {
  it("UTCの日付をまたいでいても、JSTの月を返す", () => {
    // UTC 2026-09-30T15:30 = JST 2026-10-01T00:30
    expect(jstYearMonth(Date.parse("2026-09-30T15:30:00Z"))).toEqual({ year: 2026, monthIndex0: 9 });
  });
});

describe("fixedCostReminderMonth", () => {
  it("支払日当日は通知する", () => {
    const row = { dueDay: 27, notifyDaysBefore: 3, lastNotifiedMonth: null, active: true };
    expect(fixedCostReminderMonth(row, jstMs("2026-09-27T12:00"), 2026, 8)).toBe("2026-09");
  });

  it("支払日のnotifyDaysBefore日前から通知する", () => {
    const row = { dueDay: 27, notifyDaysBefore: 3, lastNotifiedMonth: null, active: true };
    expect(fixedCostReminderMonth(row, jstMs("2026-09-24T00:00"), 2026, 8)).toBe("2026-09");
    expect(fixedCostReminderMonth(row, jstMs("2026-09-23T23:00"), 2026, 8)).toBeNull();
  });

  it("月をまたぐ前倒し(来月1日の3日前)も見つける", () => {
    const row = { dueDay: 1, notifyDaysBefore: 3, lastNotifiedMonth: null, active: true };
    // 今日はJSTで9月29日、来月(10月)の支払日が対象になる。
    expect(fixedCostReminderMonth(row, jstMs("2026-09-29T09:00"), 2026, 8)).toBe("2026-10");
  });

  it("同じ支払い月ぶんは二度と通知しない", () => {
    const row = { dueDay: 27, notifyDaysBefore: 3, lastNotifiedMonth: "2026-09", active: true };
    expect(fixedCostReminderMonth(row, jstMs("2026-09-27T12:00"), 2026, 8)).toBeNull();
  });

  it("停止中・通知設定なしなら通知しない", () => {
    const row = { dueDay: 27, notifyDaysBefore: 3, lastNotifiedMonth: null, active: false };
    expect(fixedCostReminderMonth(row, jstMs("2026-09-27T12:00"), 2026, 8)).toBeNull();
    expect(fixedCostReminderMonth({ ...row, active: true, notifyDaysBefore: null }, jstMs("2026-09-27T12:00"), 2026, 8)).toBeNull();
  });
});

describe("通知文面", () => {
  it("予定: 開始時刻を添える", () => {
    const payload = JSON.parse(buildEventReminderPayload("歯医者", "10:00"));
    expect(payload.title).toBe("まもなく: 歯医者");
    expect(payload.body).toContain("10:00");
    expect(payload.url).toBe("/schedule?view=today");
  });

  it("タスク: 期限が近い旨を出す", () => {
    const payload = JSON.parse(buildTaskReminderPayload("健康診断の予約"));
    expect(payload.title).toContain("健康診断の予約");
    expect(payload.url).toBe("/schedule?view=today");
  });

  it("固定費: 金額と支払日を添える", () => {
    const payload = JSON.parse(buildFixedCostReminderPayload("家賃", 80000, 27));
    expect(payload.title).toContain("家賃");
    expect(payload.body).toBe("毎月27日 ・ ¥80,000");
    expect(payload.url).toBe("/records/expense");
  });
});
