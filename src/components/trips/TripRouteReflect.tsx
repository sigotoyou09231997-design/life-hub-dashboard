import { Check, X } from "lucide-react";
import { formatDisplayDate } from "../../lib/date";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import { reflectRows, type ReflectRow } from "../../lib/tripRouteReflect";

interface Props {
  dayList: string[];
  schedule: TripScheduleItem[];
  places: TripRoutePlace[];
  /** 「入れない」と選んだ予定の id。 */
  excluded: string[];
  /** 「入れる」(on)・「入れない」(!on)を押した時。 */
  onChoose: (item: TripScheduleItem, on: boolean) => void;
}

const STATE_NOTE: Record<ReflectRow["state"], string> = {
  in: "ルートに入っています",
  out: "まだ選んでいません",
  off: "入れません",
  none: "地図に置ける場所が無いので、選べません",
};

/**
 * 日程の予定ごとに、ルートへ「入れる／入れない」を選ぶ一覧(src/lib/tripRouteReflect.ts)。
 * 日にちごとに並べる。1つの予定に2つのボタン — 押した方に印が付き、選んでいない間はどちらも付かない。
 * 時刻の順は日程と同じ。日付が旅行の日にちに無い予定(期間を直した後など)は、最後の「ほかの日」に並べる。
 */
export function TripRouteReflect({ dayList, schedule, places, excluded, onChoose }: Props) {
  const rows = reflectRows(schedule, places, excluded);
  if (rows.length === 0) {
    return <p className="trip-reflect__empty">日程に予定がありません。予定を入れると、ここでルートに入れるかを選べます。</p>;
  }
  const known = new Set(dayList);
  const groups = [
    ...dayList.map((date, i) => ({ key: date, title: `${i + 1}日目`, sub: formatDisplayDate(date), rows: rows.filter((row) => row.item.date === date) })),
    { key: "other", title: "ほかの日", sub: "", rows: rows.filter((row) => !known.has(row.item.date)) },
  ].filter((group) => group.rows.length > 0);

  return (
    <div className="trip-reflect">
      <p className="trip-reflect__lead">
        予定ごとに、ルートに入れるかを選べます。「入れる」を押すと予定の場所がルートに入り、「入れない」を押すとルートから外れて、「日程に入っている場所」にも出なくなります。
      </p>
      {groups.map((group) => (
        <section key={group.key} className="trip-reflect__day">
          <h3>
            {group.title}
            {group.sub && <span>・{group.sub}</span>}
            <b>{group.rows.length}</b>
          </h3>
          <ul>
            {group.rows.map(({ item, state, placeName }) => (
              <li key={item.id} data-state={state}>
                <div className="trip-reflect__body">
                  <p title={item.title}>{item.title}</p>
                  <small>
                    {[item.startTime, placeName && placeName !== item.title ? placeName : ""].filter(Boolean).join("・")}
                    {item.startTime || (placeName && placeName !== item.title) ? " / " : ""}
                    {STATE_NOTE[state]}
                  </small>
                </div>
                {state === "none" ? null : (
                  <div className="trip-reflect__choice" role="group" aria-label={`${item.title}をルートに入れるか`}>
                    <button
                      type="button"
                      className="trip-reflect__btn"
                      aria-pressed={state === "in"}
                      onClick={() => state !== "in" && onChoose(item, true)}
                    >
                      <Check size={14} aria-hidden="true" />
                      入れる
                    </button>
                    <button
                      type="button"
                      className="trip-reflect__btn"
                      aria-pressed={state === "off"}
                      onClick={() => state !== "off" && onChoose(item, false)}
                    >
                      <X size={14} aria-hidden="true" />
                      入れない
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
