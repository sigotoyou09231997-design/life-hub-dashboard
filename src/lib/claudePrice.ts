import type { AnthropicReceipt } from "./anthropicBilling";

/**
 * Claude(Anthropic)のサブスクの、ドル建ての請求を円に直す(2026-10-20、本人「サブスクの Claude Code の金額が違う、税込でも出して」)。
 *
 * Claude は米ドルで請求され、日本では消費税(JCT)10% が足される。たとえば Max 5x は 税抜 $100 ＋ 消費税 $10 ＝ 税込 $110。
 * 以前は円にする時に 1ドル150円の決め打ちで、実際の請求(2026-10-19 の請求書は 1ドル157.95円で ¥17,375)と
 * 千円近くずれていた。円はその日の為替(src/lib/currency.ts の fetchRateToYen)で直し、取れない時だけ下の目安を使う。
 */

/** 日本の消費税。Claude の請求書の「JCT - Japan (10%)」。 */
export const JCT_RATE = 0.1;

/** 為替が取れなかった時の目安(2026-10-19 の請求書の換算 157.95円に近い値)。 */
export const FALLBACK_USD_JPY = 158;

/** お手本(src/lib/subscriptionTemplates.ts)のプランごとの、税抜のドル(claude.com/pricing)。 */
export const CLAUDE_PLAN_NET_USD: Record<string, number> = {
  "claude-pro": 20,
  "claude-pro-yearly": 200,
  "claude-max": 100,
  "claude-max-20x": 200,
};

export interface ClaudePrice {
  /** 税抜・消費税・税込(ドル)。 */
  netUsd: number;
  taxUsd: number;
  totalUsd: number;
  /** 同じものを円にしたもの(1円未満は四捨五入。請求書の円の書き方と同じ)。 */
  netYen: number;
  taxYen: number;
  totalYen: number;
  /** 円にした時の1ドルの値段。 */
  rate: number;
  /** どこから決めたか: 領収書(Gmail)/ 選んだプランの定価。 */
  source: "receipt" | "plan";
  /** 領収書から決めた時の、支払った日(YYYY-MM-DD)とプランの名前。 */
  paidOn?: string;
  label?: string;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** ドルを円に(1円未満は四捨五入)。 */
export function usdToYenAt(usd: number, rate: number): number {
  // 157.95 × 100 が 15794.999… になるような小数の誤差で、四捨五入が1円ずれないように、先に細かい桁で丸める。
  return Math.round(Number((cents(usd) * rate).toFixed(6)));
}

/**
 * Claude のサブスクの請求を決める。いちばん新しいサブスクの領収書があればその額(実際に払った額)、
 * 無ければ選んだプランの定価に消費税を足した額。どちらも分からなければ null。
 */
export function claudeBilledPrice(
  receipts: AnthropicReceipt[],
  serviceKey: string | null | undefined,
  rate: number,
): ClaudePrice | null {
  const latest = receipts
    .filter((receipt) => receipt.kind === "subscription" && receipt.total > 0)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn))[0];

  let netUsd: number;
  let taxUsd: number;
  let extra: Pick<ClaudePrice, "source" | "paidOn" | "label">;
  if (latest) {
    taxUsd = cents(latest.tax);
    netUsd = cents(latest.total - latest.tax);
    extra = { source: "receipt", paidOn: latest.paidOn, label: latest.label };
  } else {
    const plan = serviceKey ? CLAUDE_PLAN_NET_USD[serviceKey] : undefined;
    if (plan == null) return null;
    netUsd = plan;
    taxUsd = cents(plan * JCT_RATE);
    extra = { source: "plan" };
  }
  const totalUsd = cents(netUsd + taxUsd);
  // 円の税込は「税込のドル × レート」。税抜と消費税を別々に丸めて足すと、1円ずれることがあるため。
  const totalYen = usdToYenAt(totalUsd, rate);
  const taxYen = usdToYenAt(taxUsd, rate);
  return { netUsd, taxUsd, totalUsd, netYen: totalYen - taxYen, taxYen, totalYen, rate, ...extra };
}

/** 税込の円から、税抜と消費税に分ける(消費税10%。1円未満は四捨五入)。 */
export function splitTaxIncludedYen(totalYen: number): { netYen: number; taxYen: number } {
  const netYen = Math.round(totalYen / (1 + JCT_RATE));
  return { netYen, taxYen: totalYen - netYen };
}
