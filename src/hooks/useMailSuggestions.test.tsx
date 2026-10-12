/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SyncedEmail } from "../types";
import { useMailSuggestions } from "./useMailSuggestions";

afterEach(cleanup);

const NEXT_YEAR = new Date().getFullYear() + 1;

function mail(id: string, subject: string, snippet = ""): SyncedEmail {
  return {
    id,
    accountId: "acc",
    gmailMessageId: `g-${id}`,
    threadId: `t-${id}`,
    from: "採用担当 <hr@example.com>",
    subject,
    snippet,
    receivedAt: Date.parse("2026-10-01T09:00:00+09:00"),
    status: "unprocessed",
    createdAt: 0,
  };
}

describe("useMailSuggestions", () => {
  it("予定候補と支出候補を、描画のあとに求める", async () => {
    const emails = [
      mail("plan", `面接のご案内 ${NEXT_YEAR}年3月5日 14:00`),
      mail("expense", "ご注文の確認", "合計 ¥1,280 のお支払い"),
      mail("none", "ただのお知らせ"),
    ];
    const { result } = renderHook(() => useMailSuggestions("acc-1", emails));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.plan.map((e) => e.id)).toEqual(["plan"]);
    expect(result.current?.expense.map((e) => e.id)).toEqual(["expense"]);
  });

  it("たくさんのメールでも、何度かに分けて最後まで求める", async () => {
    const emails = Array.from({ length: 3000 }, (_, i) => mail(`m${i}`, `面接のご案内 ${NEXT_YEAR}年3月5日 14:00 その${i}`));
    const { result } = renderHook(() => useMailSuggestions("acc-big", emails));
    await waitFor(() => expect(result.current?.plan).toHaveLength(3000), { timeout: 8000 });
  });

  it("開き直した時は、計算が終わる前から直前の結果を返す", async () => {
    const emails = [mail("plan", `面接のご案内 ${NEXT_YEAR}年3月5日 14:00`)];
    const first = renderHook(() => useMailSuggestions("acc-reopen", emails));
    await waitFor(() => expect(first.result.current?.plan).toHaveLength(1));
    first.unmount();

    const second = renderHook(() => useMailSuggestions("acc-reopen", emails));
    expect(second.result.current?.plan).toHaveLength(1);
  });

  it("ほかのアカウントの結果は返さない", async () => {
    const emails = [mail("plan", `面接のご案内 ${NEXT_YEAR}年3月5日 14:00`)];
    const a = renderHook(() => useMailSuggestions("acc-a", emails));
    await waitFor(() => expect(a.result.current?.plan).toHaveLength(1));
    const b = renderHook(() => useMailSuggestions("acc-b", undefined));
    expect(b.result.current).toBeUndefined();
  });
});

describe("useMailSuggestions — メール1通ごとの判定の控え", () => {
  it("同じメールは、開き直しても判定をやり直さず、同じ結果になる", async () => {
    const emails = [
      mail("c-plan", `面接のご案内 ${NEXT_YEAR}年3月5日 14:00`),
      mail("c-expense", "ご注文の確認", "合計 ¥1,280 のお支払い"),
    ];
    const first = renderHook(() => useMailSuggestions("acc-cache", emails));
    await waitFor(() => expect(first.result.current).toBeDefined());
    first.unmount();

    // 中身の同じメールを、別の配列で渡し直す(Dexie は読むたびに新しいオブジェクトを返す)
    const again = emails.map((email) => ({ ...email }));
    const second = renderHook(() => useMailSuggestions("acc-cache-2", again));
    await waitFor(() => expect(second.result.current).toBeDefined());
    expect(second.result.current?.plan.map((e) => e.id)).toEqual(["c-plan"]);
    expect(second.result.current?.expense.map((e) => e.id)).toEqual(["c-expense"]);
  });

  it("本文が変わったメールは、前の結果を使わずに判定し直す", async () => {
    const before = [mail("c-change", "ただのお知らせ")];
    const first = renderHook(() => useMailSuggestions("acc-change", before));
    await waitFor(() => expect(first.result.current).toBeDefined());
    expect(first.result.current?.plan).toHaveLength(0);
    first.unmount();

    const after = [mail("c-change", `面接のご案内 ${NEXT_YEAR}年3月5日 14:00`)];
    const second = renderHook(() => useMailSuggestions("acc-change-2", after));
    await waitFor(() => expect(second.result.current?.plan).toHaveLength(1));
  });
});
