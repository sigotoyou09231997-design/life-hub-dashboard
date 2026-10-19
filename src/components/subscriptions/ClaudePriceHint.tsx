import { useState } from "react";
import { loadBilling } from "../../lib/anthropicBilling";
import { claudeBilledPrice, splitTaxIncludedYen } from "../../lib/claudePrice";
import { useUsdJpyRate } from "../../hooks/useUsdJpyRate";

/** 登録の金額と請求の差がこの割合までなら、そろえるボタンを出さない。 */
const CLOSE_ENOUGH_RATIO = 0.03;

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const usd = (n: number) => `$${n.toFixed(2)}`;

function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

interface Props {
  /** フォームに入っている金額(文字のまま)。 */
  amount: string;
  serviceKey: string | null;
  /** 「この金額にする」を押した時。税込の円を渡す。 */
  onUse: (totalYen: number) => void;
}

/**
 * Claude のサブスクの金額欄の下に出す、請求の内訳(税抜・消費税・税込を、ドルと円で)。
 * 領収書(Gmail から読んだもの。src/lib/anthropicBilling.ts)があれば実際に払った額、無ければ選んだプランの定価。
 * 円はその日の為替で直す(以前の 1ドル150円の決め打ちだと、実際の請求と千円近くずれた)。
 */
export function ClaudePriceHint({ amount, serviceKey, onUse }: Props) {
  const [receipts] = useState(() => loadBilling().receipts);
  const { rate, live } = useUsdJpyRate();
  const price = claudeBilledPrice(receipts, serviceKey, rate);
  const entered = Number(amount) || 0;

  if (!price) {
    if (entered <= 0) return null;
    const split = splitTaxIncludedYen(entered);
    return (
      <div className="claude-price" aria-label="Claude の請求の内訳">
        <p className="claude-price__note">
          入れた金額を税込とすると、税抜 {yen(split.netYen)}・消費税 {yen(split.taxYen)} です。
        </p>
      </div>
    );
  }

  const title =
    price.source === "receipt" && price.paidOn
      ? `Claude の請求（${dayLabel(price.paidOn)} の領収書${price.label ? `・${price.label.replace(/^Claude\s*/, "")}` : ""}）`
      : "Claude の請求（定価）";
  // 為替は毎日動くので、合わせた翌日に数円ずれただけでボタンを出し続けない。カードの換算・手数料の差もこのくらいはある。
  const differs = Math.abs(entered - price.totalYen) > price.totalYen * CLOSE_ENOUGH_RATIO;

  return (
    <div className="claude-price" aria-label="Claude の請求の内訳">
      <p className="claude-price__title">{title}</p>
      <dl className="claude-price__table">
        <div>
          <dt>税抜</dt>
          <dd>
            {yen(price.netYen)}
            <small>{usd(price.netUsd)}</small>
          </dd>
        </div>
        <div>
          <dt>消費税 10%</dt>
          <dd>
            {yen(price.taxYen)}
            <small>{usd(price.taxUsd)}</small>
          </dd>
        </div>
        <div className="is-total">
          <dt>税込</dt>
          <dd>
            {yen(price.totalYen)}
            <small>{usd(price.totalUsd)}</small>
          </dd>
        </div>
      </dl>
      <p className="claude-price__note">
        1ドル{price.rate.toFixed(2)}円（{live ? "今日の為替" : "目安"}）で円にしています。カード会社の換算で、実際の引き落としは少し違うことがあります。
      </p>
      {differs && (
        <button type="button" className="claude-price__use" onClick={() => onUse(price.totalYen)}>
          金額を {yen(price.totalYen)}（税込）にする
        </button>
      )}
    </div>
  );
}
