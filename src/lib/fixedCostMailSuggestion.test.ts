import { describe, expect, it } from "vitest";
import { detectPayDay, isFixedCostMail, toFixedCostDraft } from "./fixedCostMailSuggestion";

const mail = (over: { from?: string; subject?: string; snippet?: string; planText?: string; expenseSuggestionDismissedAt?: number }) => ({
  from: "中国電力 <info@example.co.jp>",
  subject: "",
  snippet: "",
  status: "unprocessed" as const,
  ...over,
});

describe("料金のお知らせのメールから固定費の下書き", () => {
  it("電気料金のお知らせ: 電気代・水道光熱費・金額・口座振替日", () => {
    const email = mail({ subject: "【中国電力】10月分 電気料金のお知らせ", planText: "ご請求金額 8,123円 口座振替日 2026年10月26日" });
    expect(isFixedCostMail(email)).toBe(true);
    expect(toFixedCostDraft(email)).toEqual({ title: "電気代", category: "水道光熱費", amount: 8123, cycle: "monthly", dueDay: 26 });
  });

  it("スマホの利用料金: スマホ・通信費", () => {
    const email = mail({ from: "ahamo <noreply@example.jp>", subject: "ご利用料金確定のお知らせ", snippet: "今月のご利用料金は 2,970円 です" });
    expect(toFixedCostDraft(email)).toMatchObject({ title: "スマホ", category: "通信費", amount: 2970 });
  });

  it("種類が分からない請求は「その他の固定費」で、名前は差出人", () => {
    const email = mail({ from: "スポーツクラブ ABC <billing@example.jp>", subject: "月会費のご請求", snippet: "ご請求額 ¥9,800" });
    expect(toFixedCostDraft(email)).toMatchObject({ title: "スポーツクラブ ABC", category: "その他の固定費", amount: 9800 });
  });

  it("金額が無い・宣伝・「あとで」にしたメールは出さない", () => {
    expect(isFixedCostMail(mail({ subject: "電気料金のお知らせ", snippet: "マイページでご確認ください" }))).toBe(false);
    expect(isFixedCostMail(mail({ subject: "【セール】今だけ月額 980円！", snippet: "キャンペーン実施中" }))).toBe(false);
    expect(isFixedCostMail(mail({ subject: "電気料金のお知らせ", snippet: "ご請求金額 8,123円", expenseSuggestionDismissedAt: 1 }))).toBe(false);
  });
});

describe("払う日(detectPayDay)", () => {
  it("振替日・お支払期限・引落日の「日」を取る", () => {
    expect(detectPayDay("口座振替日：2026年10月26日")).toBe(26);
    expect(detectPayDay("お支払期限 11/4")).toBe(4);
    expect(detectPayDay("引落日は 10月27日(月) です")).toBe(27);
    expect(detectPayDay("ご利用期間 10月1日〜10月31日")).toBeUndefined();
  });
});
