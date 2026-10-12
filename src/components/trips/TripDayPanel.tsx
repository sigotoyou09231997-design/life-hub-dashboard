import { ChevronRight } from "lucide-react";
import type { TripExpense, TripScheduleItem } from "../../types";
import type { TripWeather } from "../../lib/weather";
import { formatDisplayDate } from "../../lib/date";
import { expensesOnDay } from "../../lib/tripDaySpend";
import { TripDayRoute } from "./TripDayRoute";
import { TripDayWeatherCard } from "./TripDayWeather";

interface Props {
  /** いま日程で見ている日(YYYY-MM-DD)。 */
  date: string;
  /** その日が何日目か(1始まり)。 */
  dayNumber: number;
  /** 旅行の全日程。経路と、費用がどの日のものかを決めるのに使う。 */
  schedule: TripScheduleItem[];
  weather?: TripWeather;
  /** 旅行の全部の費用。この中から見ている日のぶんを拾う(src/lib/tripDaySpend.ts)。 */
  expenses: TripExpense[];
  budget?: number;
  onEditExpense: (expense: TripExpense) => void;
  /** 「費用を見る」— 費用タブへ切り替える。 */
  onShowExpenses: () => void;
}

/** 右の欄に並べる費用の上限。これより多い日は「ほか N件」にして、欄が画面の高さを超えないようにする。 */
const MAX_ROWS = 6;

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/**
 * PCの日程タブの右の欄。左で見ている1日の「天気・地図・費用」を、日程の横にまとめて出す。
 *
 * 2026-10-12 まで、PCでも日程は1列で、文字は画面の左半分に収まり、右半分が空いていた。
 * その日の経路の地図はボタンを押してシートで開く形だったので、日程と地図を見比べられなかった。
 * 右の欄はスクロールしても付いてくる(styles/trips.css の position: sticky)ので、
 * 長い1日を下まで読んでも、地図と天気は横に残る。スマホは今までどおり1列(この欄は出さない)。
 */
export function TripDayPanel({ date, dayNumber, schedule, weather, expenses, budget, onEditExpense, onShowExpenses }: Props) {
  const dayExpenses = expensesOnDay(expenses, schedule, date);
  const dayTotal = dayExpenses.reduce((sum, e) => sum + e.amount, 0);
  const tripTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const shown = dayExpenses.slice(0, MAX_ROWS);
  const rest = dayExpenses.length - shown.length;

  return (
    <aside className="trip-day-panel" aria-label={`${dayNumber}日目の天気・地図・費用`}>
      <section className="trip-day-panel__block">
        <p className="trip-day-panel__day">
          {dayNumber}日目<span>・{formatDisplayDate(date)}</span>
        </p>
        <TripDayWeatherCard weather={weather} date={date} />
      </section>

      <section className="trip-day-panel__block" aria-label="この日の経路">
        <h3 className="trip-day-panel__heading">この日の経路</h3>
        <TripDayRoute items={schedule} date={date} inline />
      </section>

      <section className="trip-day-panel__block trip-day-panel__block--spend" aria-label="この日の費用">
        <h3 className="trip-day-panel__heading">
          この日の費用
          <b>{yen(dayTotal)}</b>
        </h3>
        {dayExpenses.length === 0 ? (
          <p className="trip-day-panel__muted">この日の費用はまだありません。予定に金額を入れると、ここにも出ます。</p>
        ) : (
          <ul className="trip-day-panel__expenses">
            {shown.map((expense) => (
              <li key={expense.id}>
                <button type="button" onClick={() => onEditExpense(expense)} aria-label={`${expense.title}の費用を編集`}>
                  <span className="trip-day-panel__expense-name">
                    {expense.title}
                    {expense.paidBy && <small>{expense.paidBy}</small>}
                  </span>
                  <span className="trip-day-panel__expense-amount">{yen(expense.amount)}</span>
                </button>
              </li>
            ))}
            {rest > 0 && <li className="trip-day-panel__more">ほか {rest}件</li>}
          </ul>
        )}
        <div className="trip-day-panel__foot">
          <p>
            旅行全体 <b>{yen(tripTotal)}</b>
            {budget != null && <span> / 予算 {yen(budget)}</span>}
          </p>
          <button type="button" className="trip-day-panel__link" onClick={onShowExpenses}>
            費用を見る
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
    </aside>
  );
}
