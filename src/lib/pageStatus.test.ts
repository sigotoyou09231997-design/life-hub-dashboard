import { describe, expect, it } from "vitest";
import { expenseStatusText, notesStatusText, scheduleStatusText, tripsStatusText } from "./pageStatus";

describe("ページの見出しの下の「いまの状態」", () => {
  it("予定・タスク: 件数と、全部済んだ日", () => {
    expect(scheduleStatusText(0, 0, 0)).toBe("今日は予定0件・未完了のタスク0件");
    expect(scheduleStatusText(2, 3, 5)).toBe("今日は予定2件・未完了のタスク3件");
    expect(scheduleStatusText(1, 0, 4)).toBe("今日は予定1件・タスクは全部完了");
  });

  it("お金管理: 給料日までの日数があれば足す。金額は3桁区切り", () => {
    expect(expenseStatusText(0, null)).toBe("今月の支出 ¥0");
    expect(expenseStatusText(12800, 12)).toBe("今月の支出 ¥12,800・給料日まで12日");
    expect(expenseStatusText(1280.4, 0)).toBe("今月の支出 ¥1,280・給料日まで0日");
  });

  it("メモ・リスト: 種類ごとの数。1つも無ければ「まだ何もありません」", () => {
    expect(notesStatusText({ memo: 0, checklist: 0, shopping: 0 })).toBe("まだ何もありません");
    expect(notesStatusText({ memo: 2, checklist: 1, shopping: 0 })).toBe("メモ 2・チェックリスト 1・買い物リスト 0");
  });

  it("旅行計画: 状態ごとの件数(0件の状態は出さない)。1つも無ければ「まだ旅行はありません」", () => {
    expect(tripsStatusText([])).toBe("まだ旅行はありません");
    expect(tripsStatusText(["planning", "planning", "completed"])).toBe("計画中 2件・完了 1件");
    expect(tripsStatusText(["ongoing", "planning", "completed"])).toBe("旅行中 1件・計画中 1件・完了 1件");
  });
});
