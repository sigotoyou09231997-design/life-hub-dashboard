/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  SETUP_HIDE_DAYS,
  buildSetupItems,
  computeSetupProgress,
  hideSetupChecklist,
  isSetupChecklistSuppressed,
  markSetupChecklistDone,
  type SetupFacts,
} from "./setupChecklist";

const NONE: SetupFacts = { salary: false, expense: false, event: false, homeAddress: false, googleCalendar: false };

afterEach(() => localStorage.clear());

describe("始め方のチェックリスト — 進み具合", () => {
  it("何も済んでいなければ 0/5。5つの項目が、決まった順に並ぶ", () => {
    const progress = computeSetupProgress(NONE);
    expect(progress.total).toBe(5);
    expect(progress.doneCount).toBe(0);
    expect(progress.ratio).toBe(0);
    expect(progress.complete).toBe(false);
    expect(progress.items.map((item) => item.id)).toEqual(["salary", "expense", "event", "homeAddress", "googleCalendar"]);
  });

  it("済んだ項目だけ数える。輪の長さの割合は、済んだ数 ÷ 全部", () => {
    const progress = computeSetupProgress({ ...NONE, salary: true, expense: true });
    expect(progress.doneCount).toBe(2);
    expect(progress.ratio).toBeCloseTo(0.4);
    expect(progress.items.filter((item) => item.done).map((item) => item.id)).toEqual(["salary", "expense"]);
  });

  it("全部済めば complete", () => {
    const progress = computeSetupProgress({ salary: true, expense: true, event: true, homeAddress: true, googleCalendar: true });
    expect(progress.complete).toBe(true);
    expect(progress.ratio).toBe(1);
  });

  it("押した時の行き先: 画面を移る項目と、その場で入力を開く項目", () => {
    const byId = Object.fromEntries(buildSetupItems(NONE).map((item) => [item.id, item]));
    expect(byId.salary.to).toBe("/records/expense?new=salary");
    expect(byId.expense.action).toBe("expense");
    expect(byId.event.action).toBe("event");
    expect(byId.homeAddress.to).toBe("/settings");
    expect(byId.googleCalendar.to).toBe("/settings");
  });
});

describe("始め方のチェックリスト — 出す・出さない", () => {
  const NOW = Date.parse("2026-10-13T12:00:00+09:00");

  it("はじめは出す", () => {
    expect(isSetupChecklistSuppressed(NOW)).toBe(false);
  });

  it("「今は表示しない」を押すと、14日間は出さず、過ぎたらまた出す", () => {
    hideSetupChecklist(NOW);
    expect(isSetupChecklistSuppressed(NOW + 1000)).toBe(true);
    expect(isSetupChecklistSuppressed(NOW + (SETUP_HIDE_DAYS - 1) * 86_400_000)).toBe(true);
    expect(isSetupChecklistSuppressed(NOW + SETUP_HIDE_DAYS * 86_400_000 + 1)).toBe(false);
  });

  it("全部済んだ印を付けたら、二度と出さない", () => {
    markSetupChecklistDone();
    expect(isSetupChecklistSuppressed(NOW)).toBe(true);
    expect(isSetupChecklistSuppressed(NOW + 365 * 86_400_000)).toBe(true);
  });

  it("壊れた値が入っていても、出さないことにはしない", () => {
    localStorage.setItem("lifeHubSetupChecklistHiddenUntil", "abc");
    expect(isSetupChecklistSuppressed(NOW)).toBe(false);
  });
});

describe("始め方のチェックリスト — 隠した機能(設定の「使う機能」)", () => {
  it("お金管理を隠したら、給与・支出の項目を出さず、数えにも入れない", () => {
    const progress = computeSetupProgress({ ...NONE, event: true }, ["money"]);
    expect(progress.items.map((item) => item.id)).toEqual(["event", "homeAddress", "googleCalendar"]);
    expect(progress.total).toBe(3);
    expect(progress.doneCount).toBe(1);
  });

  it("予定・タスクを隠したら予定と Google カレンダー、旅行計画を隠したら自宅の住所を出さない", () => {
    expect(computeSetupProgress(NONE, ["schedule"]).items.map((item) => item.id)).toEqual(["salary", "expense", "homeAddress"]);
    expect(computeSetupProgress(NONE, ["trips"]).items.map((item) => item.id)).toEqual(["salary", "expense", "event", "googleCalendar"]);
  });

  it("Gmail・メモ・ふりかえりを隠しても、項目は変わらない", () => {
    expect(computeSetupProgress(NONE, ["gmail", "notes", "review"]).total).toBe(5);
  });

  it("項目が1つも残らなければ、出さない(complete 扱い。0 で割らない)", () => {
    const progress = computeSetupProgress(NONE, ["money", "schedule", "trips"]);
    expect(progress.total).toBe(0);
    expect(progress.complete).toBe(true);
    expect(Number.isFinite(progress.ratio)).toBe(true);
  });
});

