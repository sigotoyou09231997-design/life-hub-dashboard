import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns";
import { Plus } from "lucide-react";
import type { CalendarEvent, Task } from "../../types";
import { db } from "../../db/schema";
import {
  UNASSIGNED_FILTER,
  collectDayChipsInRange,
  collectPersonDotsInRange,
  matchesPersonFilter,
  personIdsOf,
  sortDayChips,
  sortPeople,
  type DayChip,
} from "../../lib/eventPeople";
import { collectFixedCostChipsInRange } from "../../lib/fixedCostCalendar";
import { formatDisplayDate, parseDate, toDateStr } from "../../lib/date";
import { collectSpanDates, collectSpanDatesInRange, occurringOn } from "../../lib/eventSpan";
import { getHolidayMapForYear } from "../../lib/holidays";
import { MonthView } from "../calendar/MonthView";
import { WeekView } from "../calendar/WeekView";
import { weekDatesOf } from "../../lib/weekLayout";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { EventList } from "../calendar/EventList";
import { TaskItem } from "../tasks/TaskItem";
import { toggleTaskCompletion, deleteTaskCascade, postponeTaskToTomorrow } from "../tasks/TaskList";
import { TripAgendaList, type TripAgendaEntry } from "./TripAgendaList";
import { PersonFilter } from "./PersonFilter";
import { Card } from "../ui/Card";
import { Sheet } from "../ui/Sheet";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  tripAgenda: TripAgendaEntry[];
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onEditEvent: (e: CalendarEvent) => void;
  onDeleteEvent: (id: string) => void;
  onEditTask: (t: Task) => void;
  onAddSubtask: (parentId: string) => void;
  /** その日を初期値にして追加フォームを開く。マスをタップした日に予定が1件も
   * 無かった時に直接、2件以上あった時はその日の予定を並べたシートの「追加」
   * ボタンから呼ぶ(下のhandleSelectDate参照)。週表示で時刻の枠を押した時は、
   * その時刻も渡す(開始時刻が入った状態で開く)。 */
  onAddEvent: (date: string, startTime?: string) => void;
}

/** カレンダーの見方。「週」は PC 幅だけ(スマホは7列に時刻の軸を引く幅が無い)。 */
type CalendarMode = "month" | "week";
/** 見方は端末ごとに覚える。PC で週を選んでいても、スマホで開けば月のまま。 */
const MODE_KEY = "lifehub.calendarView";

function readStoredMode(): CalendarMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

function storeMode(mode: CalendarMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // 保存できない(プライベートブラウズなど)時は、この画面にいる間だけ覚える。
  }
}

/** 日付ごとの帯を1つにまとめる。渡した順に積む(先に渡したものが上に来る)。 */
function mergeChips(...sources: Map<string, DayChip[]>[]): Map<string, DayChip[]> {
  const merged = new Map<string, DayChip[]>();
  for (const source of sources) {
    for (const [date, chips] of source) {
      merged.set(date, [...(merged.get(date) ?? []), ...sortDayChips(chips)]);
    }
  }
  return merged;
}

export function CalendarView({
  events,
  tasks,
  tripAgenda,
  currentMonth,
  onMonthChange,
  selectedDate,
  onSelectDate,
  onEditEvent,
  onDeleteEvent,
  onEditTask,
  onAddSubtask,
  onAddEvent,
}: Props) {
  // 点は「かかっている日すべて」に打つ。初日にしか打たないと、宿泊の2日目は
  // カレンダー上では空いている日に見えてしまう。繰り返し予定は、表示中の月の枠
  // (MonthViewが描く週の並びと同じ範囲)ぶんだけ将来の回も展開する。
  const gridStart = toDateStr(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }));
  const gridEnd = toDateStr(endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }));

  // 「誰の予定か」(src/lib/eventPeople.ts)。1人も登録していないうちは絞り込みも
  // 色分けも出さないので、この機能を使わない人の画面は今までと変わらない。
  const peopleResult = useLiveQuery(() => db.eventPeople.toArray(), []);
  const people = sortPeople(peopleResult ?? []);
  const [personFilter, setPersonFilter] = useState<string[]>([]);
  const isDesktop = useIsDesktop();
  const [storedMode, setStoredMode] = useState<CalendarMode>(readStoredMode);
  const mode: CalendarMode = isDesktop ? storedMode : "month";
  function changeMode(next: CalendarMode) {
    setStoredMode(next);
    storeMode(next);
  }
  // 予定が2件以上ある日をタップした時に、その日の予定だけを並べて出すシート
  // (下のhandleSelectDate参照)。開いている日のdate文字列、閉じていればnull。
  const [dayEventsDate, setDayEventsDate] = useState<string | null>(null);
  // 消された人のidが選ばれたまま残ると、当てはまる予定が1件も無くなって
  // 「全部消えた」ように見える。いま居る人だけに絞ってから使う。
  const activeFilter = personFilter.filter(
    (id) => id === UNASSIGNED_FILTER || people.some((person) => person.id === id),
  );
  const shownEvents = events.filter((event) => matchesPersonFilter(event, activeFilter));

  const eventDates = collectSpanDatesInRange(shownEvents, gridStart, gridEnd);
  const eventDotColors = collectPersonDotsInRange(shownEvents, people, gridStart, gridEnd);

  // マスに出す帯(予定名)。点と違って件数の上限は無いので、予定の多い日はマスが伸びる。
  // 予定のあとに固定費の支払日を足す。固定費は「誰の」を持たないお金の情報なので、
  // 別の色・別の線種で出し(src/lib/fixedCostCalendar.ts)、予定としては保存しない。
  // 予定ではないので「誰の」の絞り込みの対象にもしない。
  const fixedCosts = useLiveQuery(() => db.fixedCosts.toArray(), []);
  const subscriptionDetails = useLiveQuery(() => db.subscriptionDetails.toArray(), []);
  const dayChips = mergeChips(
    collectDayChipsInRange(shownEvents, people, gridStart, gridEnd),
    collectFixedCostChipsInRange(fixedCosts ?? [], gridStart, gridEnd, subscriptionDetails ?? []),
  );

  // 週表示の固定費の帯。上の dayChips は月の枠の範囲なので、週の範囲で引き直す。
  const weekDates = mode === "week" ? weekDatesOf(selectedDate) : [];
  const weekFixedCostChips =
    mode === "week"
      ? collectFixedCostChipsInRange(fixedCosts ?? [], weekDates[0], weekDates[6], subscriptionDetails ?? [])
      : undefined;

  const taskDates = new Set(tasks.filter((t) => !t.completed && t.dueDate).map((t) => t.dueDate!));
  const tripDates = collectSpanDates(tripAgenda);

  const dayEvents = occurringOn(shownEvents, selectedDate);
  const dayTasks = tasks.filter((t) => t.dueDate === selectedDate && !t.parentTaskId);
  const dayTripAgenda = occurringOn(tripAgenda, selectedDate);
  const selectedHoliday = getHolidayMapForYear(Number(selectedDate.slice(0, 4))).get(selectedDate);

  // マスをタップした時に、日を選ぶだけでなく直接動けるようにする。
  // 予定が無い日 → その日を初期値にして追加フォームを開く。
  // 予定がちょうど1件の日 → その予定の編集フォームを開く(詳細を見て直せる)。
  // 2件以上ある日 → どれを開くか決められないので、その日の予定だけを並べた
  // シートを出す(dayEventsDate)。そこから選んで編集するか、追加もできる。
  function handleSelectDate(date: string) {
    onSelectDate(date);
    const eventsOnDate = occurringOn(shownEvents, date);
    if (eventsOnDate.length === 1) {
      onEditEvent(eventsOnDate[0]);
    } else if (eventsOnDate.length === 0) {
      onAddEvent(date);
    } else {
      setDayEventsDate(date);
    }
  }

  /** 週を動かした時。選んでいる日も一緒に動かし、月表示へ戻した時にその週の月が出るようにする。 */
  function handleWeekAnchor(date: string) {
    onSelectDate(date);
    onMonthChange(parseDate(date));
  }

  const personFilterRow = (
    <PersonFilter
      people={people}
      value={personFilter}
      onChange={setPersonFilter}
      showUnassigned={events.some((event) => personIdsOf(event).length === 0)}
    />
  );

  // 週表示では右の「その日の予定」を出さない。7列に時刻の軸を引くには幅が要るうえ、
  // その日の予定は週の列の中にもう並んでいる(同じことを横に二度並べるだけになる)。
  return (
    <div
      className={`calendar-workspace grid gap-3 ${mode === "week" ? "" : "xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,.5fr)]"}`}
    >
      <Card className="calendar-workspace__month p-4 lg:p-6">
        {isDesktop ? (
          <div className="calendar-toolbar">
            {personFilterRow}
            {/* 月/週の切り替え。2つを1本の溝に詰めず、別々のボタンとして並べる。 */}
            <div className="calendar-mode" role="group" aria-label="カレンダーの見方">
              {(
                [
                  ["month", "月"],
                  ["week", "週"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`calendar-mode__btn${mode === value ? " is-on" : ""}`}
                  aria-pressed={mode === value}
                  onClick={() => changeMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          personFilterRow
        )}
        {mode === "week" ? (
          <WeekView
            anchorDate={selectedDate}
            onAnchorChange={handleWeekAnchor}
            events={shownEvents}
            people={people}
            tasks={tasks}
            fixedCostChips={weekFixedCostChips}
            tripDates={tripDates}
            onEditEvent={onEditEvent}
            onEditTask={onEditTask}
            onAddEvent={(date, startTime) => {
              onSelectDate(date);
              onAddEvent(date, startTime);
            }}
          />
        ) : (
          <MonthView
            currentMonth={currentMonth}
            onMonthChange={onMonthChange}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            eventDates={eventDates}
            eventDotColors={eventDotColors}
            taskDates={taskDates}
            tripDates={tripDates}
            dayChips={dayChips}
          />
        )}
      </Card>

      {mode === "month" && (
        <Card className="calendar-workspace__detail space-y-5 p-5 lg:p-6">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <p className="calendar-detail-date text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}の予定</p>
              {selectedHoliday && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500">
                  {selectedHoliday}
                </span>
              )}
            </div>
            <EventList events={dayEvents} onEdit={onEditEvent} onDelete={onDeleteEvent} onDate={selectedDate} />
          </div>

          {dayTripAgenda.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}の旅行の予定</p>
              <TripAgendaList items={dayTripAgenda} onDate={selectedDate} />
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}のタスク</p>
            {dayTasks.length === 0 ? (
              <p className="calendar-compact-empty py-4 text-sm text-slate-500">タスクはありません</p>
            ) : (
              <div className="space-y-2">
                {dayTasks.map((t) => (
                  <TaskItem
                    key={t.id}
                    task={t}
                    allTasks={tasks}
                    onToggle={toggleTaskCompletion}
                    onEdit={onEditTask}
                    onDelete={deleteTaskCascade}
                    onAddSubtask={onAddSubtask}
                    onPostpone={postponeTaskToTomorrow}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      <Sheet
        open={dayEventsDate !== null}
        onClose={() => setDayEventsDate(null)}
        title={dayEventsDate ? `${formatDisplayDate(dayEventsDate)}の予定` : ""}
      >
        {dayEventsDate && (
          <div className="flex flex-col gap-4">
            <EventList
              events={occurringOn(shownEvents, dayEventsDate)}
              onEdit={(e) => {
                setDayEventsDate(null);
                onEditEvent(e);
              }}
              onDelete={onDeleteEvent}
              onDate={dayEventsDate}
            />
            <FormActions single>
              <Button
                type="button"
                onClick={() => {
                  const date = dayEventsDate;
                  setDayEventsDate(null);
                  onAddEvent(date);
                }}
              >
                <Plus size={16} /> この日に予定を追加
              </Button>
            </FormActions>
          </div>
        )}
      </Sheet>
    </div>
  );
}
