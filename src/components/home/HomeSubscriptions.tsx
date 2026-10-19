import { Link } from "react-router-dom";
import type { HomeSubscriptionRow } from "../../lib/homeLayout";
import { remainingLabel } from "../../lib/subscriptions";
import { formatShortDate } from "../../lib/date";

/**
 * ホームの「次の請求」(「寂しくないホーム」1-3、2026-10-18)。サブスクの一覧と同じ計算(src/lib/subscriptions.ts)で、
 * 次に引き落とされる順に最大3件と今月の合計。7日以内の請求は左に琥珀の点(気になることと同じ意味)。
 * 登録が0件なら何も出さない(呼ぶ側がカードごと出さない)。
 */
export function HomeSubscriptions({ rows, thisMonthCharge }: { rows: HomeSubscriptionRow[]; thisMonthCharge: number }) {
  if (rows.length === 0) return null;
  // 同じ日に複数あるときは、先頭に「10/13 に3件」を出し、あとの行は名前・金額だけ(第8弾 H-5)。
  const countByDate = new Map<string, number>();
  for (const row of rows) countByDate.set(row.next, (countByDate.get(row.next) ?? 0) + 1);
  const seen = new Set<string>();
  return (
    <div className="warm-card lh-group lh-subs">
      {rows.map((row) => {
        const grouped = (countByDate.get(row.next) ?? 0) > 1;
        const first = grouped && !seen.has(row.next);
        seen.add(row.next);
        return (
        <Link key={row.id} to={`/records/expense?tab=${row.tab}`} className={`lh-row lh-subs__row${row.soon ? " is-soon" : ""}${grouped && !first ? " is-grouped" : ""}`}>
          {first && (
            <span className="lh-subs__date">
              {formatShortDate(row.next)} に{countByDate.get(row.next)}件
            </span>
          )}
          <i className={`lh-concern__dot${row.soon ? " is-amber" : " is-none"}`} aria-hidden="true" />
          {/* 頭文字の丸(2-3)。サービス名の1文字目。 */}
          <span className="lh-subs__initial" aria-hidden="true">
            {row.title.trim().charAt(0).toUpperCase()}
          </span>
          <span className="lh-row__copy">
            <strong>{row.title}</strong>
            <small>¥{Math.round(row.amount).toLocaleString()}</small>
          </span>
          {(!grouped || first) && <span className="lh-subs__days">{remainingLabel(row.days)}</span>}
        </Link>
        );
      })}
      <p className="lh-subs__total">
        今月の合計 <b>¥{Math.round(thisMonthCharge).toLocaleString()}</b>
      </p>
    </div>
  );
}
