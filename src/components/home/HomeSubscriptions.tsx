import { Link } from "react-router-dom";
import type { HomeSubscriptionRow } from "../../lib/homeLayout";
import { remainingLabel } from "../../lib/subscriptions";

/**
 * ホームの「次の請求」(「寂しくないホーム」1-3、2026-10-18)。サブスクの一覧と同じ計算(src/lib/subscriptions.ts)で、
 * 次に引き落とされる順に最大3件と今月の合計。7日以内の請求は、残りの日数を琥珀の字で出す。
 * 登録が0件なら何も出さない(呼ぶ側がカードごと出さない)。
 */
export function HomeSubscriptions({ rows, thisMonthCharge }: { rows: HomeSubscriptionRow[]; thisMonthCharge: number }) {
  if (rows.length === 0) return null;
  // 2026-11-26(仕上げ①): 同じ日の行をまとめる見出し(「11/27 に2件」・第8弾 H-5)をやめ、どの行にも残りの日数を出す。
  // 見出しが中途半端に字下げされ、まとめた2行目だけ日数が無く、同じ日なのに表示がそろわなかったため。
  // 印は頭文字の丸1つにする(前は琥珀の点と頭文字の丸の2つ)。近いこと(7日以内)は、日数の字の色で伝える。
  return (
    <div className="warm-card lh-group lh-subs">
      {rows.map((row) => (
        <Link key={row.id} to={`/records/expense?tab=${row.tab}`} className={`lh-row lh-subs__row${row.soon ? " is-soon" : ""}`}>
          {/* 頭文字の丸(2-3)。サービス名の1文字目。 */}
          <span className="lh-subs__initial" aria-hidden="true">
            {row.title.trim().charAt(0).toUpperCase()}
          </span>
          <span className="lh-row__copy">
            <strong>{row.title}</strong>
          </span>
          <span className="lh-subs__side">
            <b className="lh-subs__amount">¥{Math.round(row.amount).toLocaleString()}</b>
            <span className="lh-subs__days">{remainingLabel(row.days)}</span>
          </span>
        </Link>
      ))}
      <p className="lh-subs__total">
        {/* 固定費(家賃など)も含む、この暦の月の引き落としの合計。サブスクのタブの数字と見分けられるよう書き添える(2026-11-27)。 */}
        {new Date().getMonth() + 1}月の引き落とし(固定費を含む) <b>¥{Math.round(thisMonthCharge).toLocaleString()}</b>
      </p>
    </div>
  );
}
