import { Link } from "react-router-dom";
import type { HomeSubscriptionRow } from "../../lib/homeLayout";
import { remainingLabel } from "../../lib/subscriptions";

/**
 * ホームの「次の請求」(「寂しくないホーム」1-3、2026-10-18)。サブスクの一覧と同じ計算(src/lib/subscriptions.ts)で、
 * 次に引き落とされる順に最大3件と今月の合計。7日以内の請求は左に琥珀の点(気になることと同じ意味)。
 * 登録が0件なら何も出さない(呼ぶ側がカードごと出さない)。
 */
export function HomeSubscriptions({ rows, thisMonthCharge }: { rows: HomeSubscriptionRow[]; thisMonthCharge: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="warm-card lh-group lh-subs">
      {rows.map((row) => (
        <Link key={row.id} to="/records/expense?tab=subs" className={`lh-row lh-subs__row${row.soon ? " is-soon" : ""}`}>
          <i className={`lh-concern__dot${row.soon ? " is-amber" : " is-none"}`} aria-hidden="true" />
          {/* 頭文字の丸(2-3)。サービス名の1文字目。 */}
          <span className="lh-subs__initial" aria-hidden="true">
            {row.title.trim().charAt(0).toUpperCase()}
          </span>
          <span className="lh-row__copy">
            <strong>{row.title}</strong>
            <small>¥{Math.round(row.amount).toLocaleString()}</small>
          </span>
          <span className="lh-subs__days">{remainingLabel(row.days)}</span>
        </Link>
      ))}
      <p className="lh-subs__total">
        今月の合計 <b>¥{Math.round(thisMonthCharge).toLocaleString()}</b>
      </p>
    </div>
  );
}
