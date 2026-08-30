import { describe, expect, it } from "vitest";
import type { CalendarEvent, DiaryEntry, Note, Task, Transaction } from "../types";
import {
  compareToPrevious,
  resolveReviewPeriod,
  summarizeReview,
  taskCompletionDate,
  type ReviewInput,
} from "./review";

/** 2026-08-27 は木曜。週(月曜始まり)は 08-24〜08-30、月は 08-01〜08-31。 */
const BASE = new Date(2026, 7, 27, 12, 0, 0);

function epoch(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

function transaction(over: Partial<Transaction> & { date: string; amount: number }): Transaction {
  return {
    type: "expense",
    category: "食費",
    isFixed: false,
    createdAt: epoch(over.date),
    ...over,
  };
}

function task(over: Partial<Task> & { title: string }): Task {
  return { priority: "medium", completed: false, repeat: "none", createdAt: 0, ...over };
}

function emptyInput(): ReviewInput {
  return { transactions: [], tasks: [], events: [], notes: [], diaryEntries: [] };
}

describe("resolveReviewPeriod", () => {
  it("今週は月曜から日曜まで", () => {
    const period = resolveReviewPeriod("week", 0, BASE);
    expect(period.start).toBe("2026-08-24");
    expect(period.end).toBe("2026-08-30");
    expect(period.label).toBe("8月24日〜8月30日");
  });

  it("今月は月初から月末まで", () => {
    const period = resolveReviewPeriod("month", 0, BASE);
    expect(period.start).toBe("2026-08-01");
    expect(period.end).toBe("2026-08-31");
    expect(period.label).toBe("2026年8月");
  });

  it("offsetの分だけ過去へ戻る", () => {
    expect(resolveReviewPeriod("week", -1, BASE).start).toBe("2026-08-17");
    expect(resolveReviewPeriod("month", -1, BASE).label).toBe("2026年7月");
  });

  it("年をまたいでも月の範囲が崩れない", () => {
    const period = resolveReviewPeriod("month", -8, BASE);
    expect(period.label).toBe("2025年12月");
    expect(period.start).toBe("2025-12-01");
    expect(period.end).toBe("2025-12-31");
  });
});

describe("taskCompletionDate", () => {
  it("未完了のタスクは日付を持たない", () => {
    expect(taskCompletionDate(task({ title: "まだ", dueDate: "2026-08-25" }))).toBeUndefined();
  });

  it("completedAt があればその日", () => {
    const done = task({ title: "済", completed: true, completedAt: epoch("2026-08-25"), dueDate: "2026-08-20" });
    expect(taskCompletionDate(done)).toBe("2026-08-25");
  });

  it("completedAt が無い古い完了タスクは期限日で代用する", () => {
    expect(taskCompletionDate(task({ title: "昔", completed: true, dueDate: "2026-08-25" }))).toBe("2026-08-25");
  });

  it("完了日も期限も無ければ数えない", () => {
    expect(taskCompletionDate(task({ title: "不明", completed: true }))).toBeUndefined();
  });
});

describe("summarizeReview", () => {
  const period = resolveReviewPeriod("week", 0, BASE);

  it("期間の外の記録は数えない", () => {
    const input: ReviewInput = {
      ...emptyInput(),
      transactions: [
        transaction({ date: "2026-08-24", amount: 1000 }),
        transaction({ date: "2026-08-30", amount: 2000 }),
        // 期間の1日前と1日後。両端を含む判定ができているかを見る。
        transaction({ date: "2026-08-23", amount: 9999 }),
        transaction({ date: "2026-08-31", amount: 9999 }),
      ],
    };
    const summary = summarizeReview(input, period);
    expect(summary.expenseTotal).toBe(3000);
    expect(summary.expenseCount).toBe(2);
  });

  it("収入と支出を混ぜない", () => {
    const input: ReviewInput = {
      ...emptyInput(),
      transactions: [
        transaction({ date: "2026-08-25", amount: 1200 }),
        transaction({ date: "2026-08-26", amount: 250000, type: "income", category: "給与" }),
      ],
    };
    const summary = summarizeReview(input, period);
    expect(summary.expenseTotal).toBe(1200);
    expect(summary.incomeTotal).toBe(250000);
    // 収入はカテゴリ別支出にも日別の棒にも入らない。
    expect(summary.expenseByCategory).toEqual([{ category: "食費", amount: 1200 }]);
    expect(summary.dailyExpenses.find((d) => d.date === "2026-08-26")?.amount).toBe(0);
  });

  it("カテゴリ別は多い順に並ぶ", () => {
    const input: ReviewInput = {
      ...emptyInput(),
      transactions: [
        transaction({ date: "2026-08-25", amount: 500, category: "食費" }),
        transaction({ date: "2026-08-25", amount: 8000, category: "交通費" }),
        transaction({ date: "2026-08-26", amount: 1500, category: "食費" }),
      ],
    };
    expect(summarizeReview(input, period).expenseByCategory).toEqual([
      { category: "交通費", amount: 8000 },
      { category: "食費", amount: 2000 },
    ]);
  });

  it("日別の棒は記録の無い日も0で埋めて、期間の日数ぶん出す", () => {
    const input: ReviewInput = {
      ...emptyInput(),
      transactions: [transaction({ date: "2026-08-26", amount: 700 })],
    };
    const summary = summarizeReview(input, period);
    expect(summary.dailyExpenses).toHaveLength(7);
    expect(summary.dailyExpenses[0]).toEqual({ date: "2026-08-24", amount: 0 });
    expect(summary.dailyExpenses[2]).toEqual({ date: "2026-08-26", amount: 700 });
    expect(summary.expensePerDay).toBe(100);
  });

  it("完了したタスクだけを、完了した日で数える", () => {
    const input: ReviewInput = {
      ...emptyInput(),
      tasks: [
        task({ title: "今週やった", completed: true, completedAt: epoch("2026-08-25") }),
        task({ title: "先週やった", completed: true, completedAt: epoch("2026-08-18") }),
        task({ title: "まだ", dueDate: "2026-08-25" }),
      ],
    };
    expect(summarizeReview(input, period).tasksCompleted).toBe(1);
  });

  it("予定・日記・メモをそれぞれ数える", () => {
    const event: CalendarEvent = { title: "面接", date: "2026-08-25", allDay: false, createdAt: 0 };
    const diary: DiaryEntry = { date: "2026-08-26", body: "書いた", createdAt: 0 };
    const note: Note = { title: "メモ", body: "", tags: [], pinned: false, createdAt: epoch("2026-08-27") };
    const summary = summarizeReview({ ...emptyInput(), events: [event], diaryEntries: [diary], notes: [note] }, period);
    expect(summary.eventCount).toBe(1);
    expect(summary.diaryCount).toBe(1);
    expect(summary.noteCount).toBe(1);
    // 3つとも別の日なので、記録があった日は3日。
    expect(summary.activeDays).toBe(3);
    expect(summary.isEmpty).toBe(false);
  });

  it("同じ日に複数の記録があっても、活動した日は1日", () => {
    const input: ReviewInput = {
      ...emptyInput(),
      transactions: [transaction({ date: "2026-08-25", amount: 100 })],
      tasks: [task({ title: "済", completed: true, completedAt: epoch("2026-08-25") })],
      diaryEntries: [{ date: "2026-08-25", body: "", createdAt: 0 }],
    };
    expect(summarizeReview(input, period).activeDays).toBe(1);
  });

  it("何も記録が無い期間は空として扱う", () => {
    const summary = summarizeReview(emptyInput(), period);
    expect(summary.isEmpty).toBe(true);
    expect(summary.activeDays).toBe(0);
    expect(summary.expensePerDay).toBe(0);
    expect(summary.dailyExpenses).toHaveLength(7);
  });
});

describe("compareToPrevious", () => {
  it("増えた分と割合を出す", () => {
    expect(compareToPrevious(12000, 10000)).toEqual({ diff: 2000, ratio: 20 });
  });

  it("減った分はマイナスで返す", () => {
    expect(compareToPrevious(8000, 10000)).toEqual({ diff: -2000, ratio: -20 });
  });

  it("前の期間が0なら割合は出さない(0からの増加は何%とも言えない)", () => {
    expect(compareToPrevious(5000, 0)).toEqual({ diff: 5000, ratio: null });
  });
});
