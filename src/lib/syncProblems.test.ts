import { describe, expect, it } from "vitest";
import { describeSyncError, summarizeSyncProblems, syncTableLabel } from "./syncProblems";
// @ts-expect-error — ビルド前チェックの素の .mjs(型定義なし)
import { expectedColumns } from "../../scripts/check-prod-schema.mjs";

describe("describeSyncError", () => {
  it("points at a forgotten SQL when a column or table is missing", () => {
    expect(describeSyncError("42703: column calendar_events.repeat does not exist")).toContain("列が足りません");
    expect(describeSyncError("PGRST204: Could not find the 'repeat' column of 'calendar_events'")).toContain("列が足りません");
    expect(describeSyncError("PGRST205: Could not find the table 'public.event_mail_links'")).toContain("表がありません");
  });

  it("falls back to a generic sentence for anything else", () => {
    expect(describeSyncError("XX000: something")).toBe("サーバーに受け付けてもらえませんでした");
  });
});

describe("summarizeSyncProblems", () => {
  it("groups rejected rows per table and ignores rows that simply have not been sent yet", () => {
    const problems = summarizeSyncProblems([
      { id: 1, table: "calendar_events", rowId: "a", op: "upsert", queuedAt: 1, lastError: "42703: x does not exist" },
      { id: 2, table: "calendar_events", rowId: "b", op: "delete", queuedAt: 2, lastError: "42703: x does not exist" },
      { id: 3, table: "tasks", rowId: "c", op: "upsert", queuedAt: 3 },
    ]);
    expect(problems).toEqual([
      expect.objectContaining({ table: "calendar_events", label: "予定", count: 2 }),
    ]);
  });
});

describe("ビルド前の本番列チェック(scripts/check-prod-schema.mjs)", () => {
  it("finds an interface and a Japanese label for every synced table", () => {
    const tables = expectedColumns() as { tableName: string; iface: string; columns: string[] }[];
    expect(tables.length).toBeGreaterThanOrEqual(17);
    for (const t of tables) {
      // 型の読み取りが壊れると、チェックが空振りして素通りになるので、ここで止める。
      expect(t.columns, t.tableName).toContain("id");
      expect(t.columns.length, t.tableName).toBeGreaterThan(5);
      expect(syncTableLabel(t.tableName), t.tableName).not.toBe(t.tableName);
    }
    const events = tables.find((t) => t.tableName === "calendar_events");
    expect(events?.columns).toEqual(expect.arrayContaining(["repeat", "repeat_until", "start_time", "person_ids"]));
  });
});
