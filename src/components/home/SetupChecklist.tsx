import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { isCalendarSyncEnabled } from "../../lib/googleCalendar";
import { useHomeAddress } from "../../lib/homePlace";
import {
  computeSetupProgress,
  hideSetupChecklist,
  isSetupChecklistSuppressed,
  markSetupChecklistDone,
  SETUP_HIDE_DAYS,
  type SetupItem,
} from "../../lib/setupChecklist";
import { openQuickAdd } from "../layout/AddChooser";
import { showToast } from "../ui/toastStore";

const RING_RADIUS = 15;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * ホームの「LIFE HUB をそろえる」(第5弾 A-4)。済んだかどうかは実際のデータから決める(手でチェックしない)。
 * 全部済んだら自動で消え、二度と出ない。「今は表示しない」で14日間だけ出さない。
 * 読み込み中は何も出さない(出たり消えたりしないため)。判定の中身は src/lib/setupChecklist.ts。
 */
export function SetupChecklist() {
  const [hidden, setHidden] = useState(() => isSetupChecklistSuppressed(Date.now()));
  const homeAddress = useHomeAddress();
  const facts = useLiveQuery(async () => {
    const [salaries, expenses, events, accounts] = await Promise.all([
      db.salaries.count(),
      db.transactions.filter((row) => row.type === "expense").count(),
      db.calendarEvents.count(),
      db.gmailAccounts.toArray(),
    ]);
    return { salary: salaries > 0, expense: expenses > 0, event: events > 0, googleCalendar: accounts.some(isCalendarSyncEnabled) };
  }, []);

  const progress = facts ? computeSetupProgress({ ...facts, homeAddress: homeAddress.trim().length > 0 }) : null;
  const complete = progress?.complete ?? false;

  // 全部済んだら、その印を残す(あとで給与や支出を消しても、もう出さない)。
  useEffect(() => {
    if (complete) markSetupChecklistDone();
  }, [complete]);

  if (hidden || !progress || progress.complete) return null;

  function handleHide() {
    hideSetupChecklist(Date.now());
    setHidden(true);
    showToast(`${SETUP_HIDE_DAYS}日間、表示しません`);
  }

  return (
    <section className="warm-card lh-setup" aria-labelledby="lh-setup-title">
      <div className="lh-setup__head">
        <svg className="lh-setup__ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r={RING_RADIUS} className="lh-setup__ring-track" />
          <circle
            cx="18"
            cy="18"
            r={RING_RADIUS}
            className="lh-setup__ring-bar"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress.ratio)}
            transform="rotate(-90 18 18)"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 id="lh-setup-title" className="lh-setup__title">LIFE HUB をそろえる</h2>
          <p className="lh-setup__sub">
            {progress.doneCount}/{progress.total} 済み・あと{progress.total - progress.doneCount}つ
          </p>
        </div>
        <button type="button" className="lh-setup__hide" onClick={handleHide}>
          今は表示しない
        </button>
      </div>
      <ul className="lh-setup__list">
        {progress.items.map((item) => (
          <li key={item.id}>
            <SetupRow item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SetupRow({ item }: { item: SetupItem }) {
  const body = (
    <>
      <span className={`lh-setup__check ${item.done ? "is-done" : ""}`} aria-hidden="true">
        {item.done && <Check size={12} strokeWidth={3.2} />}
      </span>
      <span className="lh-setup__copy">
        <strong>{item.label}</strong>
        {!item.done && <small>{item.hint}</small>}
      </span>
    </>
  );
  if (item.done) return <div className="lh-setup__row is-done">{body}</div>;
  if (item.action) {
    const kind = item.action;
    return (
      <button type="button" className="lh-setup__row" onClick={() => openQuickAdd(kind)}>
        {body}
      </button>
    );
  }
  return (
    <Link to={item.to ?? "/"} className="lh-setup__row">
      {body}
    </Link>
  );
}
