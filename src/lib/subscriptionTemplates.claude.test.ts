import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_TEMPLATES } from "./subscriptionTemplates";

const price = (key: string) => SUBSCRIPTION_TEMPLATES.find((template) => template.key === key)?.price;

/** Claude の料金は、公式の米ドル(Pro $20・年 $200・Max 5x $100・Max 20x $200)から換算した円(税込)。
 * 数字そのものより、ドルの比が崩れていないこと(2026-10-13、App Store の円が混ざって「金額おかしい」になった)を見る。 */
describe("Claude の料金の雛形", () => {
  it("Max 20x は Max 5x の2倍、Max 5x は Pro の5倍(公式のドルの比)", () => {
    expect(price("claude-max-20x")).toBe(2 * price("claude-max")!);
    expect(price("claude-max")).toBe(5 * price("claude-pro")!);
  });

  it("Pro の年額は、月額の10か月ぶん(年 $200 = 月 $20 の10倍)", () => {
    expect(price("claude-pro-yearly")).toBe(10 * price("claude-pro")!);
  });

  // 2026-10-20 に目安のレートを 150円 → 158円にした(実際の請求書は 1ドル157.95円。src/lib/claudePrice.ts)。
  it("円(税込)の値: Pro 3,476・年額 34,760・Max 5x 17,380・Max 20x 34,760", () => {
    expect([price("claude-pro"), price("claude-pro-yearly"), price("claude-max"), price("claude-max-20x")]).toEqual([3476, 34760, 17380, 34760]);
  });
});
