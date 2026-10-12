import { useMemo, type CSSProperties } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { CheckSquare } from "lucide-react";
import type { CalendarEvent, Task } from "../../types";
import { db } from "../../db/schema";
import { spanTimeText } from "../../lib/eventSpan";
import { eventChipColor } from "../../lib/eventPeople";
import { getHolidayMapForYears } from "../../lib/holidays";
import { groupDueTasks, groupWeekAhead, weekAheadDates } from "../../lib/weekAhead";
import { Card } from "../ui/Card";

/** 明日から何日ぶん出すか。ホームの「今週これから」と同じ7日。 */
const DAYS = 7;

interface Props {
  /** 今日(YYYY-MM-DD)。ここは翌日から受け持つ(今日は左の2枚が出している)。 */
  today: string;
  events: CalendarEvent[];
  tasks: Task[];
  onEditEvent: (event: CalendarEvent) => void;
  onEditTask: (task: Task) => void;
}

/**
 * 予定・タスクの「今日」タブ(PC幅)の右の列、「この先1週間」。
 *
 * PC幅では今日の2枚だけだと画面の下半分が空いていた(UI/UX 調査メモ P-3)。
 * 空いた所に、明日から7日ぶんの予定と期限のあるタスクを日ごとに並べる。
 * 日付ごとのまとめ方は、ホームの「今週これから」と同じ src/lib/weekAhead.ts。
 * 1件も無い日も行は残す — 日が飛ぶと、何曜日が空いているのかが読めなくなるため。
 */
export function WeekAheadPanel({ today, events, tasks, onEditEvent, onEditTask }: Props) {
  const dates = useMemo(() => weekAheadDates(today, DAYS), [today]);
  const eventDays = useMemo(() => groupWeekAhead(events, dates), [events, dates]);
  const taskDays = useMemo(() => groupDueTasks(tasks, dates), [tasks, dates]);
  const people = useLiveQuery(() => db.eventPeople.toArray(), []) ?? [];
  const holidays = useMemo(
    () => getHolidayMapForYears([...new Set(dates.map((date) => Number(date.slice(0, 4))))]),
    [dates],
  );

  return (
    <Card className="planning-week-module flex flex-col">
      <div className="planning-module-heading">
        <div><p>この先1週間</p></div>
        <b>{format(parseISO(dates[0]), "M/d")}〜{format(parseISO(dates[dates.length - 1]), "M/d")}</b>
      </div>
      <ol className="planning-week">
        {dates.map((date, index) => {
          const day = parseISO(date);
          const weekday = day.getDay();
          const holiday = holidays.get(date);
          const tone = holiday || weekday === 0 ? "is-sun" : weekday === 6 ? "is-sat" : "";
          const dayEvents = eventDays[index].items;
          const dayTasks = taskDays[index].items;
          const quiet = dayEvents.length === 0 && dayTasks.length === 0;
          return (
            <li key={date} className={`planning-week__day ${quiet ? "is-quiet" : ""}`}>
              <p className={`planning-week__date ${tone}`}>
                <b>{format(day, "M/d")}</b>
                <span>{format(day, "E", { locale: ja })}</span>
                {index === 0 && <em>明日</em>}
                {holiday && <small>{holiday}</small>}
              </p>
              {quiet ? (
                <p className="planning-week__none">予定なし</p>
              ) : (
                <ul className="planning-week__items">
                  {dayEvents.map((event) => (
                    <li key={`${event.id ?? event.title}-${date}`}>
                      <button
                        type="button"
                        className="planning-week__item"
                        style={{ "--chip-color": eventChipColor(event, people) } as CSSProperties}
                        onClick={() => onEditEvent(event)}
                        aria-label={`${event.title}を編集`}
                      >
                        <span className="planning-week__time">{spanTimeText(event, date)}</span>
                        <span className="planning-week__copy">
                          <strong>{event.title}</strong>
                          {event.location && <small>{event.location}</small>}
                        </span>
                      </button>
                    </li>
                  ))}
                  {dayTasks.map((task) => (
                    <li key={`task-${task.id ?? task.title}`}>
                      <button
                        type="button"
                        className="planning-week__item is-task"
                        onClick={() => onEditTask(task)}
                        aria-label={`タスク「${task.title}」を編集`}
                      >
                        <span className="planning-week__time">
                          <CheckSquare size={12} aria-hidden="true" />
                          {task.dueTime ?? "期限"}
                        </span>
                        <span className="planning-week__copy">
                          <strong>{task.title}</strong>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
