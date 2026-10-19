import { useState } from "react";
import { loadBilling } from "../../lib/anthropicBilling";
import { claudeBilledPrice, splitTaxIncludedYen } from "../../lib/claudePrice";
import { useUsdJpyRate } from "../../hooks/useUsdJpyRate";

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** 登録の金額が、為替だけで計算した額よりこの割合以上安ければ、古い金額のままだと知らせる(手数料で高くなることはあっても、安くはならない)。 */
const BELOW_MARKET_RATIO = 0.01;

function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

interface Props {
  /** フォームに入っている金額(文字のまま)。実際に引き落とされた額(税込)を入れてもらう。 */
  amount: string;
  serviceKey: string | null;
}

/**
 * Claude のサブスクの金額欄の下に出す、請求の内訳(税抜・消費税・税込を、ドルと円で)(2026-10-20)。
 *
 * Claude はドルで請求され(Max 5x は 税抜 $100 ＋ 消費税 $10 ＝ 税込 $110)、円の引き落としはカード会社が決める。
 * 為替だけで計算した額より、海外利用の手数料のぶん高くなる(本人の 10/19 の請求は、為替だけなら ¥17,375 のところ、
 * PayPay銀行の Visa デビットで ¥17,980)。引き落としの額はアプリからは分からないので、登録の金額を正として、
 * それをドルの税抜・消費税の割合で分けて見せ、為替だけの額と1ドルあたりの値段を並べる。
 */
export function ClaudePriceHint({ amount, serviceKey }: Props) {
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

  // 円は登録の金額(無ければ為替だけの額)を、ドルの税抜・消費税の割合で分ける。
  const totalYen = entered > 0 ? entered : price.totalYen;
  const taxYen = price.totalUsd > 0 ? Math.round((totalYen * price.taxUsd) / price.totalUsd) : 0;
  const netYen = totalYen - taxYen;
  const perUsd = totalYen / price.totalUsd;
  const markup = perUsd / price.rate - 1;
  const belowMarket = entered > 0 && entered < price.totalYen * (1 - BELOW_MARKET_RATIO);

  const title =
    price.source === "receipt" && price.paidOn
      ? `Claude の請求（${dayLabel(price.paidOn)} の領収書${price.label ? `・${price.label.replace(/^Claude\s*/, "")}` : ""}）`
      : "Claude の請求（定価）";

  return (
    <div className="claude-price" aria-label="Claude の請求の内訳">
      <p className="claude-price__title">{title}</p>
      <dl className="claude-price__table">
        <div>
          <dt>税抜</dt>
          <dd>
            {yen(netYen)}
            <small>{usd(price.netUsd)}</small>
          </dd>
        </div>
        <div>
          <dt>消費税 10%</dt>
          <dd>
            {yen(taxYen)}
            <small>{usd(price.taxUsd)}</small>
          </dd>
        </div>
        <div className="is-total">
          <dt>税込</dt>
          <dd>
            {yen(totalYen)}
            <small>{usd(price.totalUsd)}</small>
          </dd>
        </div>
      </dl>
      {belowMarket ? (
        <p className="claude-price__warn" role="note">
          登録の金額が、為替だけで計算した額（{yen(price.totalYen)}）より安くなっています。銀行やカードの明細にある、実際に引き落とされた額に直してください。
        </p>
      ) : null}
      <p className="claude-price__note">
        {entered > 0 ? `1ドルあたり ${perUsd.toFixed(2)}円。` : ""}
        {live ? "今日の為替" : "為替の目安"}（1ドル{price.rate.toFixed(2)}円）だけで計算すると {yen(price.totalYen)}
        {entered > 0 && markup > 0.005 ? `で、差の ${(markup * 100).toFixed(1)}% はカード会社の換算や海外利用の手数料です。` : "です。"}
        引き落としはカードの手数料が上乗せされるので、明細の額をそのまま入れてください。
      </p>
    </div>
  );
}
