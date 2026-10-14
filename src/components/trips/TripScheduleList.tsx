import { useEffect, useId, useRef, useState } from "react";
import { moveInDay, orderScheduleDay } from "../../lib/scheduleOrder";
import { useLongPressReorder } from "../../hooks/useLongPressReorder";
import type { Attachment, TripExpense, TripScheduleItem } from "../../types";
import { formatDisplayDate, formatShortDate } from "../../lib/date";
import { occurringOn, spanLabel } from "../../lib/eventSpan";
import { timelineTimeParts } from "../../lib/tripTimeline";
import { getTripScheduleType } from "../../lib/tripCategories";
import { forecastForDate, forecastHorizon, type TripWeather } from "../../lib/weather";
import { TripDayWeather, TripWeatherBanner } from "./TripDayWeather";
import { Badge } from "../ui/Badge";
import { TransportModeChip } from "./transportModes";
import { PhotoStrip } from "../attachments/PhotoStrip";
import { ScheduleDetailLines } from "./ScheduleDetailLines";
import { Button } from "../ui/Button";
import { ArrowUpDown, CalendarRange, Check, ChevronLeft, ChevronRight, GripVertical, MapPin, Plus, Wallet } from "lucide-react";

interface Props {
  dayList: string[];
  items: TripScheduleItem[];
  /** 予定に貼った写真(予定の id ごと)。無ければ写真を出さない。 */
  photosBySchedule?: Map<string, Attachment[]>;
  /** 予定の費用(TripExpense.scheduleId ごと)。あれば「¥17,000・えっくん」を出す。 */
  expenseBySchedule?: Map<string, TripExpense>;
  /** 行を押した時(編集を開く)。予定の削除も、開いた編集の中から行う。 */
  onEdit: (item: TripScheduleItem) => void;
  onLocationTap: (location: string, title: string, date: string) => void;
  /** 長押しで予定を動かした時に書き直す並び順(src/lib/scheduleOrder.ts)。無ければ並べ替えられない。 */
  onReorder?: (changes: { id: string; sortOrder: number }[]) => void;
  /** その日を初期値にして「予定を追加」を開く。 */
  onAddForDate: (date: string) => void;
  /** 行き先の天気予報。まだ引いている最中(undefined)・引けなかった場合は何も出さない
   * (src/lib/weather.ts)。 */
  weather?: TripWeather;
  /** いま見ている日(dayList のどれか)。旅行の画面が持つ — 予定を足した時に、その日へ切り替えるため。 */
  selectedDate: string;
  onSelectDate: (date: string) => void;
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
 *
 * 見る日は、上の日にちのチップ(ルートの「日にちで絞る」と同じ見た目)で切り替え、
 * 選んだ1日だけを出す(2026-10-07、「日程も下にスクロールするのがめんどくさい」)。
 * 全部の日を縦に並べていた頃は、7日間の旅行で2日目以降へ行くのに、1日目の15件ぶんを
 * 延々と送る必要があった。下には「前の日・次の日」を置き、1日を読み終えたらそのまま次へ進める。
 *
 * 行に出すのは中身だけにした(2026-10-12)。それまでは全部の行に「↑」「↓」とゴミ箱が付いていて、
 * 20件ほどある日は矢印とゴミ箱ばかりが目に入り、スクロールの途中でゴミ箱を押しかけた。
 * - 並べ替えは、持ち物と同じく長押しして上下に動かす(src/hooks/useLongPressReorder.ts)。
 * - 削除は、行を押して開く編集の中(TripScheduleForm)へ移した。
 * - 種類の札は「その他」なら出さない。種類を選ばなかった予定ほど多く、全部の行に同じ札が並ぶだけだった。
 *
 * ただ、矢印を消すと「並べ替えられる」こと自体が見えなくなった(日の下に小さな案内を1行置いただけ)。
 * そこで、日の見出しの横に「並べ替え」のボタンを置き、押した時だけ各行の右に「つまみ」を出す。
 * - ボタンはいつも見えているので、一度きりの案内のように読み飛ばして終わりにならない。
 * - つまみは押した瞬間から動かせる。パソコンのマウスでは長押しを思いつかないので、こちらが本命。
 * - ふだんの行は中身だけのまま(つまみを常に出すと、矢印を消した意味が無くなる)。長押しは近道として残す。
 * - つまみはキーボードの ↑ ↓ でも1つずつ動かせる。
 */
export function TripScheduleList({ dayList, items, photosBySchedule, expenseBySchedule, onEdit, onLocationTap, onReorder, onAddForDate, weather, selectedDate, onSelectDate }: Props) {
  const chipsRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  // 組 = 日付。指を離した時点の並び(時刻の順 + 並べ替えた順)の中で動かす。
  const reorder = useLongPressReorder((date, from, to) => {
    onReorder?.(moveInDay(orderScheduleDay(occurringOn(items, date)), from, to));
  });
  /** 「並べ替え」を押して、つまみを出している日。日ごとに持つので、別の日へ切り替えた先はふだんの表示で出る。 */
  const [sortingDay, setSortingDay] = useState<string | null>(null);
  /** キーボードで動かした予定。並びが書き変わると行の要素が動いて押した所が外れるので、戻すために控える。 */
  const refocusRef = useRef<string | null>(null);

  useEffect(() => {
    const id = refocusRef.current;
    if (!id) return;
    const grip = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-grip-for]") ?? []).find(
      (el) => el.dataset.gripFor === id,
    );
    if (grip) {
      grip.focus();
      refocusRef.current = null;
    }
  }, [items]);

  // 選んだ日のチップが、横に並べきれない時でも見えるところへ送る。
  useEffect(() => {
    chipsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [selectedDate]);

  if (dayList.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">旅行の日程を先に設定してください</p>;
  }

  // 見るのは1日だけ。7日の旅行だと、全部を縦に並べては、下へ下へとスクロールする羽目になる。
  // dayList に無い日(旅行の期間を直した直後など)が来ても、1日目に落とす。
  const selectedIndex = Math.max(0, dayList.indexOf(selectedDate));
  const shownDays = dayList.map((date, i) => ({ date, i })).filter(({ i }) => i === selectedIndex);

  /** 前後の日へ。下のボタンから切り替えた時は、日にちのチップが見える所まで戻す(新しい日の頭から読めるように)。 */
  function goToDay(date: string) {
    onSelectDate(date);
    chipsRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  const forecasts = weather?.status === "ok" ? weather.days : [];
  const horizon = forecastHorizon(forecasts);
  // 16日より先はどのAPIでも予報が無い。旅行がそこまで届いている時だけ断りを出す。
  const beyondHorizon = horizon != null && dayList[dayList.length - 1] > horizon;

  return (
    <div className="trip-day-list" ref={rootRef}>
      {weather?.status === "ok" && weather.place && (
        <TripWeatherBanner
          placeName={weather.place.name}
          country={weather.place.country}
          horizon={horizon}
          beyondHorizon={beyondHorizon}
        />
      )}
      <div className="trip-route__days" role="group" aria-label="日にちを切り替える" ref={chipsRef}>
        {dayList.map((date, i) => (
          <button
            key={date}
            type="button"
            className={`trip-route__day${i === selectedIndex ? " is-active" : ""}`}
            aria-pressed={i === selectedIndex}
            onClick={() => onSelectDate(date)}
          >
            {i + 1}日目 {formatShortDate(date)}
            <small>{occurringOn(items, date).length}</small>
          </button>
        ))}
      </div>
      {shownDays.map(({ date, i }) => {
        // またがる日程(2泊の宿泊など)は、初日だけでなくその間の日すべてに出す。
        // 時刻の順。並べ替えた日は、その順(src/lib/scheduleOrder.ts)。
        const dayItems = orderScheduleDay(occurringOn(items, date));
        const forecast = forecastForDate(forecasts, date);
        const canReorder = Boolean(onReorder) && dayItems.length > 1;
        const sorting = canReorder && sortingDay === date;
        // 長押しで動かしている間は、落とす位置へ動かした並びで見せる。
        const shownItems = canReorder ? reorder.preview(date, dayItems) : dayItems;

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
            {canReorder && (
              <div className="trip-day__tools">
                {/* 押すと「完了」に変わる。選んでいる間は黒(日にちのチップと同じ、選んでいる所だけ黒の決まり)。 */}
                <button
                  type="button"
                  className={`trip-day__sort${sorting ? " is-active" : ""}`}
                  onClick={() => setSortingDay(sorting ? null : date)}
                >
                  {sorting ? <Check size={15} aria-hidden="true" /> : <ArrowUpDown size={15} aria-hidden="true" />}
                  {sorting ? "完了" : "並べ替え"}
                </button>
              </div>
            )}
            {sorting && (
              <p className="trip-day__hint" id={hintId}>
                右の <GripVertical size={13} aria-label="つまみ" className="inline align-[-2px]" /> を上下に動かすと、順番を変えられます。行を長押ししても動かせます。
              </p>
            )}
            {dayItems.length === 0 ? (
              <button type="button" className="trip-day__add" onClick={() => onAddForDate(date)}>
                <Plus size={14} />
                予定を追加
              </button>
            ) : (
              <>
                <ol className={`trip-timeline${sorting ? " is-sorting" : ""}`} ref={reorder.containerRef}>
                  {shownItems.map((item) => {
                    const index = dayItems.indexOf(item);
                    const typeDef = getTripScheduleType(item.type);
                    // 「その他」は種類を選ばなかった時の既定。全部の行に同じ札が並ぶだけなので出さない。
                    const showType = typeDef.value !== "other";
                    const expense = item.id ? expenseBySchedule?.get(item.id) : undefined;
                    const span = spanLabel(item, date);
                    const showTransport = item.type === "transport" && Boolean(item.transportMode);
                    const time = timelineTimeParts(item, date);
                    const dragging = canReorder && reorder.isDragging(date, index);
                    return (
                      <li
                        key={item.id}
                        {...(canReorder ? reorder.rowProps(date, index) : {})}
                        className={`trip-timeline__item trip-timeline__item--${item.type}${dragging ? " is-dragging" : ""}`}
                      >
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
                          <div className="pointer-events-none relative z-10 min-w-0">
                            <p className="trip-timeline__title line-clamp-2" title={item.title}>
                              {item.title}
                            </p>
                            {(item.location || item.endLocation) && (
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-accent">
                                {item.location && (
                                  <button
                                    type="button"
                                    onClick={() => onLocationTap(item.location!, item.title, item.date)}
                                    className="pointer-events-auto flex items-center gap-1 active:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                                  >
                                    <MapPin size={12} />
                                    {item.location}
                                  </button>
                                )}
                                {/* 移動の目的地(出発地 → 目的地)。押すと、ルートのその場所へ飛ぶ。 */}
                                {item.endLocation && (
                                  <>
                                    {item.location && <span aria-hidden="true">→</span>}
                                    <button
                                      type="button"
                                      onClick={() => onLocationTap(item.endLocation!, item.title, item.date)}
                                      aria-label={`目的地 ${item.endLocation}`}
                                      className="pointer-events-auto flex items-center gap-1 active:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                                    >
                                      {!item.location && <MapPin size={12} />}
                                      {item.endLocation}
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                            <div className="pointer-events-auto">
                              <ScheduleDetailLines item={item} />
                            </div>
                            {(showType || showTransport || expense || span) && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                {showType && (
                                  <Badge tone={typeDef.tone} className="trip-timeline__badge">
                                    {typeDef.label}
                                  </Badge>
                                )}
                                {showTransport && <TransportModeChip mode={item.transportMode!} />}
                                {expense && (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-600">
                                    <Wallet size={12} aria-hidden="true" />
                                    ¥{Math.round(expense.amount).toLocaleString()}
                                    {expense.paidBy ? `・${expense.paidBy}` : ""}
                                  </span>
                                )}
                                {span && (
                                  <span className="flex items-center gap-0.5 whitespace-nowrap text-xs font-medium text-slate-500">
                                    <CalendarRange size={12} />
                                    {span}
                                  </span>
                                )}
                              </div>
                            )}
                            {item.id && (photosBySchedule?.get(item.id)?.length ?? 0) > 0 && (
                              <div className="pointer-events-auto mt-2">
                                <PhotoStrip attachments={photosBySchedule!.get(item.id)!} limit={4} interactive />
                              </div>
                            )}
                          </div>
                        </div>
                        {sorting && (
                          <button
                            type="button"
                            className="trip-timeline__grip"
                            aria-label={`${item.title}を動かす`}
                            aria-describedby={hintId}
                            data-grip-for={item.id}
                            {...reorder.handleProps(date, index)}
                            onKeyDown={(event) => {
                              const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
                              if (to === null) return;
                              event.preventDefault();
                              const changes = moveInDay(dayItems, index, to);
                              if (changes.length === 0) return;
                              refocusRef.current = item.id ?? null;
                              onReorder?.(changes);
                            }}
                          >
                            <GripVertical size={18} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </section>
        );
      })}
      {dayList.length > 1 && (
        <nav className="mt-3 flex gap-3" aria-label="前後の日へ">
          {selectedIndex > 0 ? (
            <Button type="button" variant="secondary" className="flex-1" onClick={() => goToDay(dayList[selectedIndex - 1])}>
              <ChevronLeft size={16} />
              前の日({selectedIndex}日目)
            </Button>
          ) : (
            <span className="flex-1" />
          )}
          {selectedIndex < dayList.length - 1 ? (
            <Button type="button" variant="secondary" className="flex-1" onClick={() => goToDay(dayList[selectedIndex + 1])}>
              次の日({selectedIndex + 2}日目)
              <ChevronRight size={16} />
            </Button>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
      )}
    </div>
  );
}
