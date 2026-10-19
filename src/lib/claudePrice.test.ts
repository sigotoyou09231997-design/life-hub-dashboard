import { describe, expect, it } from "vitest";
import type { AnthropicReceipt } from "./anthropicBilling";
import { claudeBilledPrice, splitTaxIncludedYen, usdToYenAt } from "./claudePrice";
import { SUBSCRIPTION_TEMPLATES } from "./subscriptionTemplates";

/** 2026-10-19 の請求書(Max plan - 5x: 税抜 $100.00、JCT 10% $10.00、税込 $110.00、円の換算 157.95)。 */
const MAX_RECEIPT: AnthropicReceipt = {
  messageId: "m1",
  receiptNo: "2772-7138-4270",
  paidOn: "2026-10-19",
  total: 110,
  tax: 10,
  kind: "subscription",
  label: "Claude Max 5x",
};

describe("Claude の請求を円に(claudeBilledPrice)", () => {
  it("請求書と同じレートなら、請求書と同じ円になる(消費税 ¥1,580・税込 ¥17,375)", () => {
    expect(claudeBilledPrice([MAX_RECEIPT], "claude-max", 157.95)).toMatchObject({
      netUsd: 100,
      taxUsd: 10,
      totalUsd: 110,
      netYen: 15795,
      taxYen: 1580,
      totalYen: 17375,
      source: "receipt",
      paidOn: "2026-10-19",
    });
  });

  it("いちばん新しいサブスクの領収書を使い、API クレジットの領収書は使わない", () => {
    const older = { ...MAX_RECEIPT, messageId: "m0", receiptNo: "1", paidOn: "2026-09-19", total: 100, tax: 0 };
    const credit: AnthropicReceipt = { ...MAX_RECEIPT, messageId: "c", receiptNo: "2", paidOn: "2026-10-20", total: 11, tax: 1, kind: "credit", label: "クレジットの自動補充" };
    expect(claudeBilledPrice([older, credit, MAX_RECEIPT], null, 150)?.totalUsd).toBe(110);
  });

  it("領収書が無ければ、選んだプランの定価に消費税を足す", () => {
    expect(claudeBilledPrice([], "claude-max", 157.95)).toMatchObject({ totalUsd: 110, totalYen: 17375, source: "plan" });
    expect(claudeBilledPrice([], "claude-pro", 150)).toMatchObject({ netUsd: 20, taxUsd: 2, totalYen: 3300 });
  });

  it("領収書もプランも分からなければ、決めない", () => {
    expect(claudeBilledPrice([], null, 150)).toBeNull();
    expect(claudeBilledPrice([], "netflix-standard", 150)).toBeNull();
  });

  it("小数の誤差で四捨五入が1円ずれない(157.95 × 100 = 15795)", () => {
    expect(usdToYenAt(100, 157.95)).toBe(15795);
    expect(usdToYenAt(10, 157.95)).toBe(1580);
  });
});

describe("税込の円を、税抜と消費税に分ける(splitTaxIncludedYen)", () => {
  it("¥17,375 → 税抜 ¥15,795・消費税 ¥1,580", () => {
    expect(splitTaxIncludedYen(17375)).toEqual({ netYen: 15795, taxYen: 1580 });
    expect(splitTaxIncludedYen(16500)).toEqual({ netYen: 15000, taxYen: 1500 });
  });
});

describe("Claude のお手本の金額", () => {
  it("定価のドルに消費税を足して、1ドル158円の目安で円にする(Max 5x は ¥17,380)", () => {
    const price = (key: string) => SUBSCRIPTION_TEMPLATES.find((t) => t.key === key)?.price;
    expect(price("claude-max")).toBe(17380);
    expect(price("claude-pro")).toBe(3476);
    expect(price("claude-max-20x")).toBe(34760);
  });
});
