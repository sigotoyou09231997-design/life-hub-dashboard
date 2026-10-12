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
