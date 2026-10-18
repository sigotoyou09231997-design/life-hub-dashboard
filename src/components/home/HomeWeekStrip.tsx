import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { StripDay, UpcomingRow } from "../../lib/homeLayout";
import { formatShortDate } from "../../lib/date";
import { EmptyIllustration } from "../ui/EmptyIllustration";

interface Props {
  days: StripDay[];
  rows: UpcomingRow[];
  /** 予定とタスクを読み終えたか。読み込み中は「ありません」を出さない(一瞬だけ出て跳ねないように)。 */
  ready: boolean;
  onAdd: (kind: "event" | "task") => void;
}

/**
 * ホームの「今日と、この先」(「寂しくないホーム」1-1、2026-10-18)。
 * 上は今日から7日の帯(曜日・日付・予定とタスクの点)、下はこの先の予定とタスクを日付の近い順に最大4行。
 * 日を押すとその日のカレンダーへ。7日とも空なら1行の文と「＋予定」「＋タスク」。0件の数字は出さない(点も出さない)。
 * 何を出すかは src/lib/homeLayout.ts の weekStrip / upcomingRows。
 */
export function HomeWeekStrip({ days, rows, ready, onAdd }: Props) {
  const addButtons = (
    <div className="lh-week__add">
      <button type="button" className="lh-add-pill" onClick={() => onAdd("event")}>
        <Plus size={14} aria-hidden="true" />
        予定
      </button>
      <button type="button" className="lh-add-pill" onClick={() => onAdd("task")}>
        <Plus size={14} aria-hidden="true" />
        タスク
      </button>
    </div>
  );
  return (
    <div className="warm-card lh-week">
      <div className="lh-week__strip" role="list" aria-label="この1週間">
        {days.map((day, index) => {
          const total = day.events + day.tasks;
          return (
            <Link
              key={day.date}
              style={{ "--i": index } as CSSProperties}
              to={`/schedule?view=calendar&date=${day.date}`}
              role="listitem"
              className={`lh-week__day${day.isToday ? " is-today" : ""}`}
              aria-label={`${formatShortDate(day.date)}${day.isToday ? " 今日" : ""} 予定${day.events}件 タスク${day.tasks}件`}
            >
              <small>{day.weekday}</small>
              <b>{day.day}</b>
              <span className="lh-week__dots" aria-hidden="true">
                {day.events > 0 && <i className="lh-week__dot is-event" />}
                {day.tasks > 0 && <i className="lh-week__dot is-task" />}
                {total >= 3 && <em>{total}</em>}
              </span>
            </Link>
          );
        })}
      </div>
      {!ready ? null : rows.length === 0 ? (
        <div className="lh-week__empty">
          <EmptyIllustration kind="calendar" size={64} />
          <p>この1週間、予定もタスクもありません。ゆっくりできそうです。</p>
          {addButtons}
        </div>
      ) : (
        <>
          <div className="lh-week__rows">
            {rows.map((row) => (
              <Link
                key={row.key}
                to={row.kind === "event" ? `/schedule?view=calendar&date=${row.date}` : "/schedule?view=list"}
                className={`lh-week__row is-${row.kind}`}
              >
                <span className="lh-week__date">{formatShortDate(row.date)}</span>
                <span className="lh-week__time">{row.time ?? (row.kind === "event" ? "終日" : "")}</span>
                <strong>{row.title}</strong>
                {row.kind === "task" && <small>タスク</small>}
              </Link>
            ))}
          </div>
          {addButtons}
        </>
      )}
    </div>
  );
}
