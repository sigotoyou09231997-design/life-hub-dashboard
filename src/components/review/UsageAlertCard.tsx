import { Link } from "react-router-dom";
import { ArrowRight, TrendingDown } from "lucide-react";
import type { UsageAlert } from "../../lib/featureUsage";

/** ホームに出す1枚に並べる件数。残りは件数だけ出し、中身はふりかえり画面で見る。 */
const ALERT_PREVIEW_LIMIT = 2;

/**
 * 使われなくなった機能のお知らせ(ホーム)。お知らせが無い月は何も描かない —
 * 「使われていない機能はありません」の空カードを毎日出しても、見る意味が無いため。
 *
 * data-reveal(ホームの出てくる動き)は付けない。集計は開いた後に届くので、動きの
 * 見張り(useHubMotion)が付いた後に現れた要素は、透明のまま出てこなくなる。
 */
export function UsageAlertCard({ alerts, onDismiss }: { alerts: UsageAlert[]; onDismiss: () => void }) {
  if (alerts.length === 0) return null;
  const shown = alerts.slice(0, ALERT_PREVIEW_LIMIT);
  const rest = alerts.length - shown.length;

  return (
    <article className="warm-card warm-usage" aria-label="最近使われていない機能">
      <div className="warm-card__head">
        <h2 className="warm-card__title">最近使われていない機能</h2>
        <span className="warm-card__badge">{alerts.length}件</span>
      </div>
      <ul className="warm-list">
        {shown.map((alert) => (
          <li key={alert.usage.feature.id} className="warm-list__row">
            <span className="warm-usage__icon" aria-hidden="true">
              <TrendingDown size={15} />
            </span>
            <span className="warm-list__copy">
              <strong>{alert.message}</strong>
              <small>{alert.detail}</small>
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="warm-usage__more">ほか {rest} 件</p>}
      <div className="warm-usage__actions">
        <Link to="/review" className="warm-usage__button is-primary">
          ふりかえりで見る <ArrowRight size={13} />
        </Link>
        <button type="button" onClick={onDismiss} className="warm-usage__button">
          今月は表示しない
        </button>
      </div>
    </article>
  );
}
