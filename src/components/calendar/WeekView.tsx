import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { addDays, format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { CheckSquare, ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent, EventPerson, Task } from "../../types";
import { toDateStr, todayStr } from "../../lib/date";
import { spanTimeText } from "../../lib/eventSpan";
import { eventChipColor, type DayChip } from "../../lib/eventPeople";
import { minutesToClock } from "../../lib/eventTime";
import { getHolidayMapForYears } from "../../lib/holidays";
import { groupDueTasks } from "../../lib/weekAhead";
import { parseSoccerMatch } from "../../lib/soccerMatch";
import { SoccerCrests } from "./SoccerCrests";
import { assignLanes, blockBox, hourRangeFor, placeOverlapping, rollingWeekDatesOf, stripSegments, timedBlocksOn, weekDatesOf, weekTitle } from "../../lib/weekLayout";

/** 期限のあるタスクの帯の色。月表示のタスクの点(bg-warning)と同じ色にそろえる。 */
const TASK_CHIP_COLOR = "#CF9448";

interface Props {
  /** 見ている週の中の1日(カレンダーで選んでいる日)。その日を含む月曜はじまりの週を出す。 */
  anchorDate: string;
  /** 前の週・次の週・今週へ動かす時に、新しく見る日を渡す。 */
  onAnchorChange: (date: string) => void;
  /** 「誰の」の絞り込みを済ませた予定。 */
  events: CalendarEvent[];
  people: EventPerson[];
  tasks: Task[];
  /** 固定費の支払日の帯(src/lib/fixedCostCalendar.ts)。月表示と同じものを上の帯に出す。 */
  fixedCostChips?: Map<string, DayChip[]>;
  /** 旅行の日程がある日(月表示の橙の点と同じ)。 */
  tripDates?: Set<string>;
  onEditEvent: (event: CalendarEvent) => void;
  onEditTask: (task: Task) => void;
  /** 空いている所を押した時。時刻の枠ならその時刻、上の帯なら日付だけを渡す。 */
  onAddEvent: (date: string, startTime?: string) => void;
}

type StripEntry =
  | { kind: "event"; key: string; startCol: number; endCol: number; continuesBefore: boolean; continuesAfter: boolean; event: CalendarEvent }
  | { kind: "fixedCost"; key: string; startCol: number; endCol: number; chip: DayChip }
  /** 同じ日のサブスク(固定費)が2件以上ある時の「サブスク N件」の1本(第8弾 S-2)。押すと内訳に開く。 */
  | { kind: "fixedCostGroup"; key: string; startCol: number; endCol: number; date: string; chips: DayChip[] }
  | { kind: "task"; key: string; startCol: number; endCol: number; task: Task };

const ROLLING_KEY = "lifehub.weekViewRolling";
function readRolling(): boolean {
  try {
    return window.localStorage.getItem(ROLLING_KEY) === "1";
  } catch {
    return false;
  }
}
function storeRolling(on: boolean) {
  try {
    window.localStorage.setItem(ROLLING_KEY, on ? "1" : "0");
  } catch {
    // 覚えられない環境でも、この画面を開いている間は効く。
  }
}

/** 今の時刻の線を、開いたままでも1分ごとに動かす。 */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * カレンダーの「週」表示(PC幅だけ)。7日の列に時刻の軸を引き、予定を開始〜終了の
 * 位置に置く。終日・何日かにまたがる予定・時刻の無い予定・固定費・期限のあるタスクは
 * 上の帯にまとめる。
 *
 * 予定を押すと編集、空いている所を押すとその日時で追加(月表示のマスを押した時と
 * 同じ入口を使う)。並べ方の計算は src/lib/weekLayout.ts にある。
 */
export function WeekView({
  anchorDate,
  onAnchorChange,
  events,
  people,
  tasks,
  fixedCostChips,
  tripDates,
  onEditEvent,
  onEditTask,
  onAddEvent,
}: Props) {
  // 「今日から7日」(第8弾 S-2)。初期は月曜はじまり。選んだら端末に覚える。
  const [rolling, setRolling] = useState(() => readRolling());
  const weekDates = useMemo(() => (rolling ? rollingWeekDatesOf(anchorDate) : weekDatesOf(anchorDate)), [anchorDate, rolling]);
  /** 「サブスク N件」を押して内訳に開いた日。 */
  const [openSubs, setOpenSubs] = useState<ReadonlySet<string>>(() => new Set());
  const now = useMinuteClock();
  const today = todayStr();
  const holidayMap = useMemo(
    () => getHolidayMapForYears([...new Set(weekDates.map((date) => Number(date.slice(0, 4))))]),
    [weekDates],
  );

  // 上の帯。予定(長い帯が先に段を取る)→ 固定費 → タスク の順に渡し、同じ日の中では
  // この順のまま積む(assignLanes は同じ長さなら渡した順を崩さない)。
  const strip = useMemo(() => {
    const sortedEvents = [...events].sort(
      (a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title, "ja"),
    );
    const entries: StripEntry[] = stripSegments(sortedEvents, weekDates, (event) => event.id ?? event.title).map(
      (segment) => ({ kind: "event" as const, ...segment, event: segment.item }),
    );
    weekDates.forEach((date, col) => {
      const chips = fixedCostChips?.get(date) ?? [];
      // 同じ日のサブスクは1本にまとめる(押すと内訳に開く)。枠が縦に伸びないように(第8弾 S-2)。
      if (chips.length >= 2 && !openSubs.has(date)) {
        entries.push({ kind: "fixedCostGroup", key: `subs-${date}`, startCol: col, endCol: col, date, chips });
        return;
      }
      for (const chip of chips) {
        entries.push({ kind: "fixedCost", key: chip.key, startCol: col, endCol: col, chip });
      }
    });
    groupDueTasks(tasks, weekDates).forEach((day, col) => {
      for (const task of day.items) {
        entries.push({ kind: "task", key: `task-${task.id ?? task.title}-${day.date}`, startCol: col, endCol: col, task });
      }
    });
    const laned = assignLanes(entries);
    const lanes = laned.reduce((max, entry) => Math.max(max, entry.lane + 1), 0);
    return { laned, lanes };
  }, [events, tasks, fixedCostChips, weekDates, openSubs]);

  // 時刻の枠。重なりは日ごとに横へ並べ、枠の上下は週の中でいちばん早い・遅い予定に合わせる。
  const days = useMemo(() => weekDates.map((date) => placeOverlapping(timedBlocksOn(events, date))), [events, weekDates]);
  const range = useMemo(() => hourRangeFor(days.flat()), [days]);
  const hours = Array.from({ length: range.end - range.start }, (_, i) => range.start + i);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowInRange = nowMinutes >= range.start * 60 && nowMinutes <= range.end * 60;
  const nowTop = blockBox(nowMinutes, nowMinutes, range).top;

  // 前の週・次の週は、選んでいる日ごと7日ずらす(曜日を保つので、月表示へ戻した時も
  // 同じ曜日が選ばれている)。
  const shift = (offset: number) => onAnchorChange(toDateStr(addDays(parseISO(anchorDate), offset)));

  return (
    <div className="week-view" style={{ "--week-hours": hours.length } as CSSProperties}>
      <div className="week-view__nav">
        <button type="button" className="week-view__nav-btn" onClick={() => shift(-7)} aria-label="前の週">
          <ChevronLeft size={18} />
        </button>
        <p className="week-view__title">{weekTitle(weekDates)}</p>
        <button type="button" className="week-view__nav-btn" onClick={() => shift(7)} aria-label="次の週">
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          className="week-view__this-week"
          onClick={() => onAnchorChange(today)}
          disabled={weekDates.includes(today)}
        >
          今週
        </button>
        <button
          type="button"
          className={`week-view__rolling${rolling ? " is-on" : ""}`}
          aria-pressed={rolling}
          onClick={() => {
            const next = !rolling;
            setRolling(next);
            storeRolling(next);
            if (next) onAnchorChange(today);
          }}
          title="週の初めを、月曜ではなく今日にする"
        >
          今日から7日
        </button>
      </div>

      <div className="week-view__grid">
        {/* 曜日と日付の見出し */}
        <div className="week-view__row week-view__row--head">
          <span className="week-view__corner" aria-hidden="true" />
          {weekDates.map((date) => {
            const day = parseISO(date);
            const holiday = holidayMap.get(date);
            const weekday = day.getDay();
            const tone = holiday || weekday === 0 ? "is-sun" : weekday === 6 ? "is-sat" : "";
            return (
              <div key={date} className={`week-view__day-head ${tone} ${date === today ? "is-today" : ""}`}>
                <span className="week-view__weekday">{format(day, "E", { locale: ja })}</span>
                <span className="week-view__date">{format(day, "d")}</span>
                {holiday && <span className="week-view__holiday">{holiday}</span>}
                {tripDates?.has(date) && <span className="week-view__trip" title="旅行の予定があります" aria-label="旅行の予定あり" />}
              </div>
            );
          })}
        </div>

        {/* 上の帯: 終日・何日かにまたがる予定・時刻の無い予定・固定費・タスク */}
        <div className="week-view__row week-view__row--strip">
          <span className="week-view__axis-label">終日</span>
          <div
            className="week-view__strip"
            style={{ gridTemplateRows: `repeat(${Math.max(strip.lanes, 1)}, minmax(1.6rem, auto))` }}
          >
            {weekDates.map((date, col) => (
              <button
                key={`add-${date}`}
                type="button"
                className="week-view__strip-add"
                style={{ gridColumn: col + 1, gridRow: `1 / span ${Math.max(strip.lanes, 1)}` }}
                onClick={() => onAddEvent(date)}
                aria-label={`${format(parseISO(date), "M月d日(E)", { locale: ja })}に予定を追加`}
              />
            ))}
            {strip.laned.map((entry) => {
              const place = { gridColumn: `${entry.startCol + 1} / ${entry.endCol + 2}`, gridRow: entry.lane + 1 };
              if (entry.kind === "event") {
                const time = spanTimeText(entry.event, weekDates[entry.startCol]);
                const soccer = parseSoccerMatch(entry.event);
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className={`week-view__bar ${entry.continuesBefore ? "is-cont-before" : ""} ${entry.continuesAfter ? "is-cont-after" : ""}${soccer ? " is-soccer" : ""}`}
                    style={{ ...place, "--chip-color": eventChipColor(entry.event, people) } as CSSProperties}
                    onClick={() => onEditEvent(entry.event)}
                    title={`${entry.event.title}(${time})`}
                  >
                    {soccer ? (
                      <>
                        <SoccerCrests match={soccer} size={16} />
                        <span className="week-view__bar-text">{soccer.title}</span>
                      </>
                    ) : (
                      entry.event.title
                    )}
                  </button>
                );
              }
              if (entry.kind === "fixedCostGroup") {
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="week-view__bar is-fixed-cost is-group"
                    style={place}
                    onClick={() => setOpenSubs((prev) => new Set([...prev, entry.date]))}
                    title={entry.chips.map((chip) => chip.label).join("、")}
                  >
                    引き落とし {entry.chips.length}件
                  </button>
                );
              }
              if (entry.kind === "fixedCost") {
                return (
                  <span
                    key={entry.key}
                    className="week-view__bar is-fixed-cost"
                    style={{ ...place, "--chip-color": entry.chip.color } as CSSProperties}
                    title={entry.chip.label}
                  >
                    {entry.chip.label}
                  </span>
                );
              }
              return (
                <button
                  key={entry.key}
                  type="button"
                  className="week-view__bar is-task"
                  style={{ ...place, "--chip-color": TASK_CHIP_COLOR } as CSSProperties}
                  onClick={() => onEditTask(entry.task)}
                  title={`タスク: ${entry.task.title}`}
                >
                  <CheckSquare size={11} aria-hidden="true" />
                  {entry.task.dueTime && <small>{entry.task.dueTime}</small>}
                  {entry.task.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* 時刻の枠 */}
        <div className="week-view__row week-view__row--body">
          <div className="week-view__axis" aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour} style={{ top: `${((hour - range.start) / hours.length) * 100}%` }}>
                {hour}:00
              </span>
            ))}
          </div>
          {weekDates.map((date, col) => (
            <div key={date} className={`week-view__day ${date === today ? "is-today" : ""}`}>
              {/* 空いている所(30分ごと)。押すとその日時で追加フォームを開く。予定の箱は
                  この上に重ねるので、予定のある所を押せば予定の方が開く。 */}
              {hours.flatMap((hour) =>
                [0, 30].map((minute) => {
                  const time = minutesToClock(hour * 60 + minute);
                  return (
                    <button
                      key={time}
                      type="button"
                      className="week-view__slot"
                      style={{ top: `${((hour - range.start + minute / 60) / hours.length) * 100}%` }}
                      onClick={() => onAddEvent(date, time)}
                      aria-label={`${format(parseISO(date), "M月d日(E)", { locale: ja })} ${time}に予定を追加`}
                    >
                      <span aria-hidden="true">＋ {time.replace(/^0/, "")}</span>
                    </button>
                  );
                }),
              )}
              {days[col].map((block) => {
                const box = blockBox(block.start, block.end, range);
                const event = block.item;
                // 箱の高さで、名前を何行まで出すかを変える。45分以下は1行に名前と時刻を
                // 横並び、1時間半以上は名前を2行まで、その間は名前1行＋時刻。
                const minutes = block.end - block.start;
                const size = minutes <= 45 ? "is-short" : minutes >= 90 ? "is-tall" : "";
                const soccer = parseSoccerMatch(event);
                return (
                  <button
                    key={`${event.id ?? event.title}-${date}`}
                    type="button"
                    className={`week-view__event ${size}${soccer ? " is-soccer" : ""}`}
                    style={
                      {
                        top: `${box.top}%`,
                        height: `${box.height}%`,
                        left: `calc(${(block.column / block.columns) * 100}% + 2px)`,
                        width: `calc(${100 / block.columns}% - 4px)`,
                        "--chip-color": eventChipColor(event, people),
                      } as CSSProperties
                    }
                    onClick={() => onEditEvent(event)}
                    title={`${event.title}(${spanTimeText(event, date)})${event.location ? ` ${event.location}` : ""}`}
                  >
                    {soccer && <SoccerCrests match={soccer} size={16} />}
                    <strong>{soccer ? soccer.title : event.title}</strong>
                    <small>{spanTimeText(event, date)}</small>
                  </button>
                );
              })}
              {date === today && nowInRange && (
                <span className="week-view__now" style={{ top: `${nowTop}%` }} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
