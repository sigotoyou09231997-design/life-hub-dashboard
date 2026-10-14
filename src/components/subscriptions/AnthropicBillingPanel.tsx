import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { RefreshCw } from "lucide-react";
import { db } from "../../db/schema";
import {
  formatUsd,
  loadBilling,
  refreshBilling,
  summarizeByMonth,
  usdToYen,
  type BillingData,
} from "../../lib/anthropicBilling";
import { Button } from "../ui/Button";

/** 前回の読み込みからこれだけたっていれば、開いた時に自動で読み直す。 */
const AUTO_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
/** 月ごとの一覧に出す月数。 */
const SHOWN_MONTHS = 12;

const yen = (usd: number): string => `¥${usdToYen(usd).toLocaleString()}`;

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${year}年${Number(m)}月`;
}

function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function timeLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Claude のサブスクの編集シートに出す、Anthropic の料金(月ごと)(2026-10-14、本人「Anthropic の料金も月ごとに、Claude の枠に出したい」)。
 * Claude のサブスク(Pro / Max)に加えて、API のクレジット(単発の購入・自動補充)も、Gmail に届く領収書から集める
 * (src/lib/anthropicBilling.ts)。この端末の Gmail がつながっていないと読み込めない(つながっている時は、開くと自動で読み直す)。
 */
export function AnthropicBillingPanel() {
  const accounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const account = accounts?.find((candidate) => !candidate.reauthRequiredAt);
  const [data, setData] = useState<BillingData>(() => loadBilling());
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function load(current: BillingData) {
    if (!account) return;
    setState("loading");
    setMessage("");
    try {
      const result = await refreshBilling(account, current);
      setData(result);
      setState("idle");
      setMessage(
        result.receipts.length === 0
          ? "Anthropic の領収書は見つかりませんでした"
          : result.added > 0
            ? `新しい領収書を${result.added}件読み込みました`
            : "新しい領収書はありませんでした",
      );
      if (result.unreadable > 0) setMessage((text) => `${text}(読み取れなかったメール${result.unreadable}件)`);
    } catch (error) {
      console.error("[anthropicBilling] failed to refresh:", error);
      setState("error");
      setMessage("Gmail から読み込めませんでした。しばらくしてからもう一度お試しください");
    }
  }

  // 開いた時、Gmail がつながっていて、前回から半日以上たっていれば(または一度も読んでいなければ)読み直す。
  useEffect(() => {
    if (!account) return;
    if (data.fetchedAt && Date.now() - data.fetchedAt < AUTO_REFRESH_AFTER_MS) return;
    void load(data);
    // 開いた時と、Gmail がつながった時だけ。データが変わるたびには読み直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  const months = useMemo(() => summarizeByMonth(data.receipts).slice(0, SHOWN_MONTHS), [data.receipts]);
  const totalUsd = months.reduce((sum, row) => sum + row.total, 0);
  const latestFailure = data.failed[0];

  return (
    <section className="subs-billing" aria-label="Anthropicの料金(月ごと)">
      <div className="subs-billing__head">
        <strong>Anthropic の料金（月ごと）</strong>
        <small>Gmail の領収書から集計</small>
      </div>

      {latestFailure && (
        <p className="subs-billing__alert" role="alert">
          {dayLabel(latestFailure.on)} に {formatUsd(latestFailure.amount)} の支払いに失敗しました。カードを確認してください。
        </p>
      )}

      {months.length === 0 ? (
        <p className="subs-billing__empty">
          {account ? (state === "loading" ? "領収書を読み込んでいます…" : "まだ集計がありません。「領収書を読み込む」を押してください。") : "Gmail をつなぐと、Anthropic の領収書から料金を自動で集計できます。"}
        </p>
      ) : (
        <>
          <ul className="subs-billing__list">
            {months.map((row) => (
              <li key={row.month} className="subs-billing__month">
                <div className="subs-billing__line">
                  <span>{monthLabel(row.month)}</span>
                  <strong>
                    {yen(row.total)}
                    <small>{formatUsd(row.total)}</small>
                  </strong>
                </div>
                <div className="subs-billing__split">
                  <span>
                    サブスク {yen(row.subscription)}
                    <small>{formatUsd(row.subscription)}</small>
                  </span>
                  <span>
                    追加（APIクレジット）{yen(row.credit)}
                    <small>{formatUsd(row.credit)}</small>
                  </span>
                  {row.other > 0 && (
                    <span>
                      その他 {yen(row.other)}
                      <small>{formatUsd(row.other)}</small>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="subs-billing__total">
            {months.length}か月の合計
            <strong>{yen(totalUsd)}</strong>
          </p>
        </>
      )}

      <p className="subs-billing__note">
        領収書のドル（消費税込み）を、1ドル150円の目安で円にしています。実際のカードの請求額とは少し違います。
        {data.fetchedAt ? ` 最終更新 ${timeLabel(data.fetchedAt)}` : ""}
      </p>

      {account ? (
        <Button variant="secondary" disabled={state === "loading"} onClick={() => void load(data)}>
          <RefreshCw size={15} aria-hidden="true" />
          {state === "loading" ? "読み込んでいます…" : "領収書を読み込む"}
        </Button>
      ) : (
        <Link className="subs-actions__link" to="/gmail">
          Gmail をつなぐ
        </Link>
      )}
      {message && (
        <p className={state === "error" ? "subs-billing__alert" : "subs-billing__note"} role={state === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}
    </section>
  );
}
