import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CalendarSync, Check, ChevronDown, Home, Receipt, Wallet, type LucideIcon } from "lucide-react";
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
  type SetupItemId,
} from "../../lib/setupChecklist";
import { openQuickAdd } from "../layout/AddChooser";
import { useHiddenFeatures } from "../../hooks/useHiddenFeatures";
import { showToast } from "../ui/toastStore";

const RING_RADIUS = 15;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** 残っている項目のカードに出すアイコン(第6弾 D-7)。 */
const ITEM_ICON: Record<SetupItemId, LucideIcon> = {
  salary: Wallet,
  expense: Receipt,
  event: CalendarDays,
  homeAddress: Home,
  googleCalendar: CalendarSync,
};

/**
 * ホームの「LIFE HUB をそろえる」(第5弾 A-4)。済んだかどうかは実際のデータから決める(手でチェックしない)。
 * 全部済んだら自動で消え、二度と出ない。「今は表示しない」で14日間だけ出さない。
 * 読み込み中は何も出さない(出たり消えたりしないため)。判定の中身は src/lib/setupChecklist.ts。
 *
 * 2026-10-16(第6弾 D-7): 済んだ項目は「Nつ済み」の1行に畳む(押すと開く)。残りの項目は
 * アイコン・題名・一言・「はじめる」のカードにし、PC では横に並べる。
 */
export function SetupChecklist() {
  const [hidden, setHidden] = useState(() => isSetupChecklistSuppressed(Date.now()));
  const [doneOpen, setDoneOpen] = useState(false);
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

  // 設定の「使う機能」で隠した機能の項目は、数えにも出さない(給与・支出=お金管理、予定・Google カレンダー=予定・タスク、自宅の住所=旅行計画)。
  const hiddenFeatures = useHiddenFeatures();
  const progress = facts ? computeSetupProgress({ ...facts, homeAddress: homeAddress.trim().length > 0 }, hiddenFeatures) : null;
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

  const todo = progress.items.filter((item) => !item.done);
  const done = progress.items.filter((item) => item.done);

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
      {todo.length > 0 && (
        <ul className="lh-setup__todo">
          {todo.map((item) => (
            <li key={item.id}>
              <SetupCard item={item} />
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div className="lh-setup__done">
          <button
            type="button"
            className="lh-setup__done-toggle"
            aria-expanded={doneOpen}
            aria-controls="lh-setup-done-list"
            onClick={() => setDoneOpen((open) => !open)}
          >
            <span className="lh-setup__check is-done" aria-hidden="true">
              <Check size={12} strokeWidth={3.2} />
            </span>
            {done.length}つ済み
            <ChevronDown size={14} className="lh-setup__chevron" aria-hidden="true" />
          </button>
          <ul id="lh-setup-done-list" className="lh-setup__done-list" hidden={!doneOpen}>
            {done.map((item) => (
              <li key={item.id} className="lh-setup__done-row">
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SetupCard({ item }: { item: SetupItem }) {
  const Icon = ITEM_ICON[item.id];
  const body = (
    <>
      <span className="lh-setup__icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.9} />
      </span>
      <span className="lh-setup__copy">
        <strong>{item.label}</strong>
        <small>{item.hint}</small>
      </span>
      <span className="lh-setup__cta">
        はじめる <ArrowRight size={12} aria-hidden="true" />
      </span>
    </>
  );
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
