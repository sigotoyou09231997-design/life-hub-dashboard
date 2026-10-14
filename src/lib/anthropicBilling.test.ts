/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ids: {} as Record<string, string[]>,
  bodies: {} as Record<string, string>,
  subjects: {} as Record<string, { subject: string; receivedAt: number }>,
  queries: [] as string[],
}));

vi.mock("./gmail", () => ({
  ensureFreshAccessToken: async (account: unknown) => ({ ...(account as object), accessToken: "fresh" }),
  listMessageIdsByQuery: async (_token: string, query: string) => {
    mocks.queries.push(query);
    return mocks.ids[query] ?? [];
  },
  getMessageBody: async (_token: string, id: string) => mocks.bodies[id] ?? "",
  getMessageMeta: async (_token: string, id: string) => mocks.subjects[id],
  mapWithConcurrency: async <T,>(items: T[], _limit: number, run: (item: T) => Promise<void>) => {
    for (const item of items) await run(item);
  },
}));

import {
  EMPTY_BILLING,
  formatUsd,
  isClaudeSubscription,
  loadBilling,
  parseFailedPayment,
  parseReceipt,
  refreshBilling,
  summarizeByMonth,
  usdToYen,
} from "./anthropicBilling";
import type { GmailAccount } from "../types";

// 本人の Gmail に届いた領収書(Stripe)の本文から、カード番号・URL を除いたもの。改行の入り方はメールで違うので、わざと崩してある。
const PRO = "Receipt from Anthropic, PBC $22.00 Paid July 20, 2026 Download invoice\nReceipt number 2285-5501-6208 Invoice number C1OPLYTH-0001\n\nReceipt #2285-5501-6208 Jul 20–Aug 20, 2026 Claude Pro Qty 1 $20.00 Subtotal $20.00 Total excluding tax $20.00 JCT - Japan (10%) $2.00 Total $22.00 Amount paid $22.00";
const CREDIT_5 = "Receipt from Anthropic, PBC $5.50 Paid July 30, 2026 Receipt number 2480-3318-2981\nReceipt #2480-3318-2981 One-time credit purchase Qty 1 $5.00 Subtotal $5.00 Total excluding tax $5.00 JCT - Japan (10%) $0.50 Total $5.50";
const CREDIT_10A = "Receipt from Anthropic, PBC $11.00 Paid August 3, 2026 Receipt number 2735-6664-9804 Receipt #2735-6664-9804 One-time credit purchase Qty 1 $10.00 Subtotal $10.00 Total excluding tax $10.00 JCT - Japan (10%) $1.00 Total $11.00";
const CREDIT_10B = "Receipt from Anthropic, PBC $11.00 Paid August 4, 2026 Receipt number 2372-4289-3229 Receipt #2372-4289-3229 One-time credit purchase Qty 1 $10.00 Subtotal $10.00 Total excluding tax $10.00 JCT - Japan (10%) $1.00 Total $11.00";
const MAX_FIRST = "Receipt from Anthropic, PBC $109.23 Paid August 19, 2026 Receipt number 2880-6481-9201 Receipt #2880-6481-9201 Aug 19–Sep 19, 2026 Max plan - 5x Qty 1 $100.00 Unused time on Claude Pro after 19 Aug 2026 Qty 1 -$0.70 Subtotal $99.30 Total excluding tax $99.30 JCT - Japan (10%) $9.93 Total $109.23";
const RECHARGE_AUG = "Receipt from Anthropic, PBC $16.51 Paid August 21, 2026 Receipt number 2767-4483-5827 Receipt #2767-4483-5827 Auto-recharge credits Qty 1 $15.01 Subtotal $15.01 Total excluding tax $15.01 JCT - Japan (10%) $1.50 Total $16.51";
const MAX_SECOND = "Receipt from Anthropic, PBC $110.00 Paid September 19, 2026 Receipt number 2970-1421-5221 Receipt #2970-1421-5221 Sep 19–Oct 19, 2026 Max plan - 5x Qty 1 $100.00 Subtotal $100.00 Total excluding tax $100.00 JCT - Japan (10%) $10.00 Total $110.00";
const RECHARGE_SEP = "Receipt from Anthropic, PBC $11.04 Paid September 21, 2026 Receipt number 2967-7534-8867 Receipt #2967-7534-8867 Auto-recharge credits Qty 1 $10.04 Subtotal $10.04 Total excluding tax $10.04 JCT - Japan (10%) $1.00 Total $11.04";

const ALL = [PRO, CREDIT_5, CREDIT_10A, CREDIT_10B, MAX_FIRST, RECHARGE_AUG, MAX_SECOND, RECHARGE_SEP];

describe("parseReceipt(領収書メールの本文を読む)", () => {
  it("Claude Pro: 支払った日・税込みの合計・税・種類・名前", () => {
    expect(parseReceipt(PRO, "m1")).toEqual({ messageId: "m1", receiptNo: "2285-5501-6208", paidOn: "2026-07-20", total: 22, tax: 2, kind: "subscription", label: "Claude Pro" });
  });

  it("Max 5x(Pro の未使用分の値引きつき)は、サブスク。値引き後の合計と税を読む", () => {
    expect(parseReceipt(MAX_FIRST)).toMatchObject({ paidOn: "2026-08-19", total: 109.23, tax: 9.93, kind: "subscription", label: "Claude Max 5x" });
  });

  it("クレジットの単発の購入・自動補充は、サブスクと分ける", () => {
    expect(parseReceipt(CREDIT_5)).toMatchObject({ paidOn: "2026-07-30", total: 5.5, tax: 0.5, kind: "credit", label: "クレジットの購入(単発)" });
    expect(parseReceipt(RECHARGE_AUG)).toMatchObject({ paidOn: "2026-08-21", total: 16.51, tax: 1.5, kind: "credit", label: "クレジットの自動補充" });
  });

  it("領収書でない文章・日付や金額が読めない文章は null", () => {
    expect(parseReceipt("こんにちは")).toBeNull();
    expect(parseReceipt("Receipt from Anthropic, PBC $5.00 Paid Smarch 3, 2026")).toBeNull();
    expect(parseReceipt("")).toBeNull();
  });

  it("知らない種類の行は「その他」にして、合計には入れる", () => {
    expect(parseReceipt("Receipt from Anthropic, PBC $3.30 Paid May 2, 2026 Receipt #1111-2222-3333 Something else Qty 1 $3.00 Subtotal $3.00 Total excluding tax $3.00 Total $3.30")).toMatchObject({ kind: "other", total: 3.3, tax: 0.3 });
  });
});

describe("parseFailedPayment", () => {
  const at = new Date(2026, 9, 7, 11, 43).getTime();
  it("件名から、払おうとした金額と通知の日を読む", () => {
    expect(parseFailedPayment("$11.02 payment to Anthropic, PBC was unsuccessful", at, "f1")).toEqual({ messageId: "f1", on: "2026-10-07", amount: 11.02 });
  });
  it("失敗の通知でない件名は null", () => {
    expect(parseFailedPayment("Your receipt from Anthropic, PBC #2970-1421-5221", at)).toBeNull();
  });
});

describe("summarizeByMonth(月ごとの合計)", () => {
  it("本人の実際の領収書8通が、7月 $27.50・8月 $147.74・9月 $121.04(サブスクと追加を分けて)になる", () => {
    const receipts = ALL.map((text, i) => parseReceipt(text, `m${i}`)!);
    expect(summarizeByMonth(receipts)).toEqual([
      { month: "2026-09", subscription: 110, credit: 11.04, other: 0, total: 121.04, count: 2 },
      { month: "2026-08", subscription: 109.23, credit: 38.51, other: 0, total: 147.74, count: 4 },
      { month: "2026-07", subscription: 22, credit: 5.5, other: 0, total: 27.5, count: 2 },
    ]);
  });

  it("同じ領収書(同じ番号)が二重に入っていても、1回だけ数える", () => {
    const one = parseReceipt(PRO, "a")!;
    expect(summarizeByMonth([one, { ...one, messageId: "b" }])[0]).toMatchObject({ total: 22, count: 1 });
    expect(summarizeByMonth([])).toEqual([]);
  });
});

describe("円・ドルの出し方・Claude の見分け", () => {
  it("1ドル150円の目安で円に直す。ドルは小数2桁", () => {
    expect(usdToYen(110)).toBe(16500);
    expect(usdToYen(121.04)).toBe(18156);
    expect(formatUsd(5.5)).toBe("$5.50");
  });

  it("Claude のサブスクは、名前か、お手本の印で見分ける", () => {
    expect(isClaudeSubscription("Claude")).toBe(true);
    expect(isClaudeSubscription("Anthropic Max")).toBe(true);
    expect(isClaudeSubscription("自分用のAI", "claude-max")).toBe(true);
    expect(isClaudeSubscription("Netflix", "netflix-standard")).toBe(false);
    expect(isClaudeSubscription("Netflix", null)).toBe(false);
  });
});

describe("refreshBilling(Gmail から読む)", () => {
  const account = { id: "a1", email: "me@example.com", accessToken: "old", accessTokenExpiresAt: 0, refreshToken: "r", connectedAt: 1 } as GmailAccount;

  beforeEach(() => {
    window.localStorage.clear();
    mocks.ids = {
      "from:invoice+statements@mail.anthropic.com": ["m1", "m2", "bad"],
      "from:failed-payments@mail.anthropic.com": ["f1"],
    };
    mocks.bodies = { m1: PRO, m2: CREDIT_5, bad: "領収書ではない文章" };
    mocks.subjects = { f1: { subject: "$11.02 payment to Anthropic, PBC was unsuccessful", receivedAt: new Date(2026, 9, 7, 11, 43).getTime() } };
    mocks.queries = [];
  });

  it("領収書と失敗の通知を読んで覚える。読めなかったメールは数えて知らせる", async () => {
    const result = await refreshBilling(account, EMPTY_BILLING);
    expect(result.added).toBe(2);
    expect(result.unreadable).toBe(1);
    expect(result.receipts.map((r) => r.messageId).sort()).toEqual(["m1", "m2"]);
    expect(result.failed).toEqual([{ messageId: "f1", on: "2026-10-07", amount: 11.02 }]);
    expect(result.fetchedAt).not.toBeNull();
    // 覚えた中身を、次に開いた時に読める。
    expect(loadBilling().receipts).toHaveLength(2);
  });

  it("すでに読んだメールは読み直さない(新しいものだけ足す)。失敗の通知も二重にしない", async () => {
    const first = await refreshBilling(account, EMPTY_BILLING);
    mocks.ids["from:invoice+statements@mail.anthropic.com"] = ["m3", "m1", "m2"];
    mocks.bodies.m3 = MAX_SECOND;
    const second = await refreshBilling(account, first);
    expect(second.added).toBe(1);
    expect(second.receipts).toHaveLength(3);
    expect(second.failed).toHaveLength(1);
  });

  it("領収書が1通も無くても、エラーにしない", async () => {
    mocks.ids = {};
    const result = await refreshBilling(account, EMPTY_BILLING);
    expect(result).toMatchObject({ receipts: [], failed: [], added: 0, unreadable: 0 });
  });

  it("覚えてある中身が壊れていても、空として読む", () => {
    window.localStorage.setItem("lifeHubAnthropicBilling", "{壊れた");
    expect(loadBilling()).toEqual(EMPTY_BILLING);
  });
});
