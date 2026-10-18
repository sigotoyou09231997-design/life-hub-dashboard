/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { BlockedSender, SyncedEmail } from "../types";

const mocks = vi.hoisted(() => ({
  emails: [] as Partial<SyncedEmail>[],
  blocked: [] as Partial<BlockedSender>[],
}));

vi.mock("../db/schema", () => ({
  db: {
    syncedEmails: { orderBy: () => ({ reverse: () => ({ toArray: async () => mocks.emails }) }) },
    blockedSenders: { toArray: async () => mocks.blocked },
    tasks: { toArray: async () => [] },
    categoryBudgets: { toArray: async () => [] },
    salaries: { toArray: async () => [] },
  },
}));
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        void Promise.resolve(querier()).then(setValue);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return value;
    },
  };
});

const { useNotificationSignals } = await import("./notificationSignals");
const { isUnhandledEmail } = await import("./gmail");

function mail(id: string, extra: Partial<SyncedEmail> = {}): Partial<SyncedEmail> {
  return { id, accountId: "acc1", from: `送り主 <s${id}@example.com>`, subject: id, receivedAt: 1, status: "unprocessed", ...extra };
}

describe("ベルの「Gmail未処理」(第8弾 1-2)", () => {
  it("ホームや Gmail ページと同じ isUnhandledEmail で数える(既読・重要・送信済みは入れない)。ブロック中の送信者はアカウント＋アドレスで除く", async () => {
    mocks.emails = [
      mail("fresh"),
      mail("read", { readAt: 10 }),
      mail("important", { importantAt: 10 }),
      mail("sent", { status: "sent" }),
      mail("drafted", { status: "drafted" }),
      mail("blocked", { from: "spam <spam@example.com>" }),
      mail("otherAccountSpam", { accountId: "acc2", from: "spam <spam@example.com>" }),
    ];
    mocks.blocked = [{ accountId: "acc1", email: "spam@example.com" }];
    const { result } = renderHook(() => useNotificationSignals());
    await waitFor(() => expect(result.current.gmailUnprocessed.length).toBeGreaterThan(0));
    const ids = result.current.gmailUnprocessed.map((e) => e.id);
    expect(ids).toEqual(["fresh", "drafted", "otherAccountSpam"]);
    // 一覧の数と件数が一致し、全部が isUnhandledEmail を満たす。
    expect(result.current.total).toBe(3);
    expect(result.current.gmailUnprocessed.every((e) => isUnhandledEmail(e))).toBe(true);
  });
});
