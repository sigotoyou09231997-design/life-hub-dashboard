import { describe, expect, it } from "vitest";
import type { CalendarEvent, FixedCost, Task } from "../types";
import { aheadDates, aheadDayLabel, buildConcerns, homeStatusLine, homeSubscriptions, tripCardSize, tripCountdown, upcomingRows, weekStrip } from "./homeLayout";

describe("ホームの組み直し(2026-10-17)", () => {
  it("「今日と、この先」は今日から7日。呼び名は今日・明日・明後日(それより先は無し)", () => {
    expect(aheadDates("2026-10-17")).toHaveLength(7);
    expect(aheadDates("2026-10-17").slice(0, 3)).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
    expect(aheadDates("2026-10-17").at(-1)).toBe("2026-10-23");
    expect(aheadDayLabel("2026-10-17", "2026-10-17")).toBe("今日");
    expect(aheadDayLabel("2026-10-18", "2026-10-17")).toBe("明日");
    expect(aheadDayLabel("2026-10-19", "2026-10-17")).toBe("明後日");
    expect(aheadDayLabel("2026-10-25", "2026-10-17")).toBe("");
  });

  it("状態の一言: 件数があれば並べ、無ければ「予定もタスクもありません」。読み込み中は空", () => {
    expect(homeStatusLine(2, 1)).toBe("予定2件・タスク1件");
    expect(homeStatusLine(0, 3)).toBe("タスク3件");
    expect(homeStatusLine(0, 0)).toBe("今日は予定もタスクもありません");
    expect(homeStatusLine(undefined, 0)).toBe("");
  });

  it("次の旅行は、旅行中か30日以内なら大きなカード。それより先は控えめな写真のカード(帯は無い)", () => {
    const today = "2026-10-17";
    expect(tripCardSize({ status: "planning", startDate: "2026-10-23", endDate: "2026-10-26" }, today)).toBe("big");
    expect(tripCardSize({ status: "planning", startDate: "2026-11-16", endDate: "2026-11-18" }, today)).toBe("big");
    expect(tripCardSize({ status: "planning", startDate: "2026-12-28", endDate: "2026-12-30" }, today)).toBe("compact");
    expect(tripCardSize({ status: "ongoing", startDate: "2026-12-28", endDate: "2026-12-30" }, today)).toBe("big");
    expect(tripCardSize({ status: "planning", startDate: "2026-10-15", endDate: "2026-10-18" }, today)).toBe("big");
  });

  it("旅行カードの大きな文字: あと◯日・本日出発・旅行中はN日目", () => {
    const today = "2026-10-17";
    expect(tripCountdown({ status: "planning", startDate: "2026-12-26", endDate: "2026-12-30" }, today)).toBe("あと70日");
    expect(tripCountdown({ status: "planning", startDate: "2026-10-17", endDate: "2026-10-18" }, today)).toBe("本日出発");
    expect(tripCountdown({ status: "planning", startDate: "2026-10-16", endDate: "2026-10-18" }, today)).toBe("2日目");
    expect(tripCountdown({ status: "ongoing", startDate: "2026-10-17", endDate: "2026-10-18" }, today)).toBe("1日目");
    expect(tripCountdown({ status: "completed", startDate: "2026-10-01", endDate: "2026-10-03" }, today)).toBe("");
  });

  const ev = (id: string, date: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title: id, date, createdAt: 0, ...extra });
  const tk = (id: string, dueDate: string, extra: Partial<Task> = {}): Task => ({ id, title: id, dueDate, completed: false, priority: "medium", repeat: "none", createdAt: 0, ...extra });

  it("7日の帯: 日ごとの予定の数と、まだ終わっていないタスクの数。今日に印", () => {
    const dates = aheadDates("2026-10-17");
    const strip = weekStrip(dates, [ev("a", "2026-10-17"), ev("b", "2026-10-19", { endDate: "2026-10-20" })], [tk("t1", "2026-10-17"), tk("t2", "2026-10-17", { completed: true }), tk("t3", "2026-10-23")], "2026-10-17");
    expect(strip.map((d) => `${d.weekday}${d.day}:${d.events}/${d.tasks}${d.isToday ? "*" : ""}`)).toEqual([
      "土17:1/1*",
      "日18:0/0",
      "月19:1/0",
      "火20:1/0",
      "水21:0/0",
      "木22:0/0",
      "金23:0/1",
    ]);
  });

  it("帯の下の行: 日付の近い順・時刻順に最大4行。終わったタスクは出さない", () => {
    const dates = aheadDates("2026-10-17");
    const rows = upcomingRows(
      [ev("歯医者", "2026-10-17", { startTime: "18:30" }), ev("会議", "2026-10-17", { startTime: "10:00" }), ev("出張", "2026-10-19", { allDay: true })],
      [tk("ゴミ出し", "2026-10-17", { dueTime: "07:00" }), tk("済み", "2026-10-17", { completed: true }), tk("提出", "2026-10-18"), tk("予約", "2026-10-20")],
      dates,
    );
    expect(rows.map((r) => `${r.date.slice(5)} ${r.time ?? "--"} ${r.title}`)).toEqual(["10-17 07:00 ゴミ出し", "10-17 10:00 会議", "10-17 18:30 歯医者", "10-18 -- 提出"]);
    expect(upcomingRows([], [], dates)).toEqual([]);
  });

  it("次の請求: 近い順に最大3件、7日以内は琥珀の点。止めているものは数えない。0件なら空", () => {
    const cost = (id: string, title: string, amount: number, dueDay: number, active = true): FixedCost => ({ id, title, category: "entertainment", amount, dueDay, active });
    const items = [
      { cost: cost("a", "Netflix", 1490, 25) },
      { cost: cost("b", "Spotify", 980, 20) },
      { cost: cost("c", "iCloud", 130, 18) },
      { cost: cost("d", "Adobe", 6480, 1) },
      { cost: cost("e", "止めた", 500, 19, false) },
    ];
    const { rows, thisMonthCharge } = homeSubscriptions(items, "2026-10-17");
    expect(rows.map((r) => `${r.title} ${r.days}${r.soon ? "!" : ""}`)).toEqual(["iCloud 1!", "Spotify 3!", "Netflix 8"]);
    expect(thisMonthCharge).toBe(1490 + 980 + 130 + 6480);
    expect(homeSubscriptions([], "2026-10-17").rows).toEqual([]);
  });

  it("気になること: 赤(返信待ち・予算超え・期限切れ)を先に、琥珀(連携切れ・設定未完)を後に。無ければ空", () => {
    const rows = buildConcerns({
      waiting: [{ emailId: "m1", name: "山田", waitingDays: 5 }],
      forecasts: [{ category: "食費", projectedOver: 3200.4 }],
      overdueTasks: 2,
      reauthEmails: ["me@example.com"],
      setupItems: [{ id: "homeAddress", label: "自宅の住所を入れる", to: "/settings" }],
    });
    expect(rows.map((r) => `${r.tone}:${r.text}`)).toEqual([
      "red:山田 からの返信を 5日待っています",
      "red:食費が給料日までに予算を超えそう",
      "red:期限を過ぎたタスクが 2件",
      "amber:me@example.com の連携が切れています",
      "amber:自宅の住所を入れる",
    ]);
    expect(rows[0].to).toBe("/gmail/mail/m1");
    expect(rows[1].note).toBe("このままだと約¥3,200超え");
    expect(buildConcerns({ waiting: [], forecasts: [], overdueTasks: 0, reauthEmails: [], setupItems: [] })).toEqual([]);
  });
});
