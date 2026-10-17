import { describe, expect, it } from "vitest";
import { aheadDates, aheadDayLabel, buildConcerns, homeStatusLine, tripCardMode } from "./homeLayout";

describe("ホームの組み直し(2026-10-17)", () => {
  it("「今日と、この先」は今日から3日。呼び名は今日・明日・明後日", () => {
    expect(aheadDates("2026-10-17")).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
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

  it("次の旅行は、旅行中か30日以内なら大きなカード。それより先や旅行が無ければ1行の帯", () => {
    const today = "2026-10-17";
    expect(tripCardMode({ status: "planning", startDate: "2026-10-23", endDate: "2026-10-26" }, today)).toBe("big");
    expect(tripCardMode({ status: "planning", startDate: "2026-11-16", endDate: "2026-11-18" }, today)).toBe("big");
    expect(tripCardMode({ status: "planning", startDate: "2026-12-28", endDate: "2026-12-30" }, today)).toBe("band");
    expect(tripCardMode({ status: "ongoing", startDate: "2026-12-28", endDate: "2026-12-30" }, today)).toBe("big");
    expect(tripCardMode({ status: "planning", startDate: "2026-10-15", endDate: "2026-10-18" }, today)).toBe("big");
    expect(tripCardMode(undefined, today)).toBe("band");
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
