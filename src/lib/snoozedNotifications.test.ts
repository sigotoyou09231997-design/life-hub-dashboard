import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SNOOZE_CHOICES,
  SNOOZE_DB_NAME,
  SNOOZE_STORE,
  partitionDueSnoozes,
  snoozeMinutesForAction,
  type SnoozedNotification,
} from "./snoozedNotifications";

function record(id: string, dueAt: number): SnoozedNotification {
  return { id, title: "打ち合わせ", body: "10:00から", url: "/schedule", dueAt };
}

describe("snoozeMinutesForAction", () => {
  it("選択肢の action から待ち時間を引く", () => {
    expect(snoozeMinutesForAction("snooze-10")).toBe(10);
    expect(snoozeMinutesForAction("snooze-60")).toBe(60);
  });

  it("通知を押しただけ(action なし)や知らない action はスヌーズにしない", () => {
    expect(snoozeMinutesForAction("")).toBeNull();
    expect(snoozeMinutesForAction("open")).toBeNull();
  });
});

describe("partitionDueSnoozes", () => {
  it("時が来たものだけを、早い順に取り出す", () => {
    const { due, pending } = partitionDueSnoozes(
      [record("a", 300), record("b", 100), record("c", 900)],
      500,
    );
    expect(due.map((r) => r.id)).toEqual(["b", "a"]);
    expect(pending.map((r) => r.id)).toEqual(["c"]);
  });

  it("ちょうどの時刻は出し直す側に入れる", () => {
    expect(partitionDueSnoozes([record("a", 500)], 500).due).toHaveLength(1);
  });
});

// Service Worker(public/push-sw.js)は素のJSでこのモジュールを読み込めないため、
// 同じ定義を書き写してある。片方だけ変わると「予約したのに出し直せない」が
// 静かに起きるので、突き合わせをテストで縛る。
describe("public/push-sw.js との突き合わせ", () => {
  const source = readFileSync(new URL("../../public/push-sw.js", import.meta.url), "utf8");

  it("DB名・ストア名が同じ", () => {
    expect(source).toContain(`const SNOOZE_DB_NAME = "${SNOOZE_DB_NAME}"`);
    expect(source).toContain(`const SNOOZE_STORE = "${SNOOZE_STORE}"`);
  });

  it("「あとで」の選択肢が同じ", () => {
    for (const choice of SNOOZE_CHOICES) {
      expect(source).toContain(`action: "${choice.action}", minutes: ${choice.minutes}, title: "${choice.title}"`);
    }
  });
});
