import type { TripScheduleItem } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { occurringOn, spanLabel } from "../../lib/eventSpan";
import { timelineTimeParts } from "../../lib/tripTimeline";
import { getTripScheduleType } from "../../lib/tripCategories";
import { forecastForDate, forecastHorizon, type TripWeather } from "../../lib/weather";
import { TripDayWeather, TripWeatherBanner } from "./TripDayWeather";
import { Badge } from "../ui/Badge";
import { useConfirm } from "../ui/ConfirmProvider";
import { CalendarRange, MapPin, Plus, Trash2 } from "lucide-react";

interface Props {
  dayList: string[];
  items: TripScheduleItem[];
  onEdit: (item: TripScheduleItem) => void;
  onDelete: (id: string) => void;
  onLocationTap: (location: string, title: string) => void;
  /** その日を初期値にして「予定を追加」を開く。 */
  onAddForDate: (date: string) => void;
  /** 行き先の天気予報。まだ引いている最中(undefined)・引けなかった場合は何も出さない
   * (src/lib/weather.ts)。 */
  weather?: TripWeather;
}

/**
 * 日程は1日=1枚のカードにする。以前は日付も「予定はまだありません」も、背景の写真の上に
 * 文字だけで置いていたため、明るい写真の日は文字が沈んでほとんど読めなかった。
 * 他の一覧(ルート・費用)と同じく面の上に載せて、日付・件数・その日の予定をまとめて見せる。
 *
 * 1日の中は、左に時刻を縦に揃え、線と点でつないだ時間軸で並べる(styles/trips.css の
 * .trip-timeline)。以前は予定ごとの灰色の箱の中に時刻を小さく入れていたので、
 * 題名の長さで時刻の位置がずれ、「何時の次が何時か」を目で追いにくかった。
 *
 * 予定が無い日は1行の「予定を追加」に畳む。9日間の旅行だと空の日が縦に積み上がって
 * 延々スクロールすることになるため、空の日ほど小さく収まるようにしてある。
 */
export function TripScheduleList({ dayList, items, onEdit, onDelete, onLocationTap, onAddForDate, weather }: Props) {
  const confirm = useConfirm();

  if (dayList.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">旅行の日程を先に設定してください</p>;
  }

  const forecasts = weather?.status === "ok" ? weather.days : [];
  const horizon = forecastHorizon(forecasts);
  // 16日より先はどのAPIでも予報が無い。旅行がそこまで届いている時だけ断りを出す。
  const beyondHorizon = horizon != null && dayList[dayList.length - 1] > horizon;

  return (
    <div className="trip-day-list">
      {weather?.status === "ok" && weather.place && (
        <TripWeatherBanner
          placeName={weather.place.name}
          country={weather.place.country}
          horizon={horizon}
          beyondHorizon={beyondHorizon}
        />
      )}
      {dayList.map((date, i) => {
        // またがる日程(2泊の宿泊など)は、初日だけでなくその間の日すべてに出す。
        const dayItems = occurringOn(items, date).sort((a, b) =>
          (a.startTime ?? "").localeCompare(b.startTime ?? ""),
        );
        const forecast = forecastForDate(forecasts, date);

        return (
          <section key={date} className={`trip-day${dayItems.length === 0 ? " trip-day--empty" : ""}`}>
            <header className="trip-day__head">
              <span className="trip-day__index" aria-hidden="true">
                {i + 1}
              </span>
              <h3>
                {i + 1}日目<span>・{formatDisplayDate(date)}</span>
              </h3>
              {forecast && <TripDayWeather forecast={forecast} />}
              {dayItems.length > 0 && <b>{dayItems.length}件</b>}
            </header>
            {dayItems.length === 0 ? (
              <button type="button" className="trip-day__add" onClick={() => onAddForDate(date)}>
                <Plus size={14} />
                予定を追加
              </button>
            ) : (
              <ol className="trip-timeline">
                {dayItems.map((item) => {
                  const typeDef = getTripScheduleType(item.type);
                  const time = timelineTimeParts(item, date);
                  return (
                    <li key={item.id} className={`trip-timeline__item trip-timeline__item--${item.type}`}>
                      <div className={`trip-timeline__time${time.plain ? " is-plain" : ""}`}>
                        <span>{time.main}</span>
                        {time.sub && <small>{time.sub}</small>}
                      </div>
                      <span className="trip-timeline__dot" aria-hidden="true" />
                      <div className="trip-timeline__body">
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          aria-label={`${item.title}を編集`}
                          className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                        />
                        <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="trip-timeline__title line-clamp-2" title={item.title}>
                              {item.title}
                            </p>
                            {item.location && (
                              <button
                                type="button"
                                onClick={() => onLocationTap(item.location!, item.title)}
                                className="pointer-events-auto mt-0.5 flex items-center gap-1 text-xs text-accent active:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                              >
                                <MapPin size={12} />
                                {item.location}
                              </button>
                            )}
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <Badge tone={typeDef.tone} className="trip-timeline__badge">
                                {typeDef.label}
                              </Badge>
                              {spanLabel(item, date) && (
                                <span className="flex items-center gap-0.5 whitespace-nowrap text-xs font-medium text-slate-500">
                                  <CalendarRange size={12} />
                                  {spanLabel(item, date)}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              if (item.id && (await confirm({ title: `「${item.title}」を削除しますか?` }))) {
                                onDelete(item.id);
                              }
                            }}
                            aria-label="削除"
                            className="pointer-events-auto shrink-0 rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
