import type { TripScheduleItem } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { getTripScheduleType } from "../../lib/tripCategories";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { Clock, MapPin, Plus, Trash2 } from "lucide-react";

interface Props {
  dayList: string[];
  items: TripScheduleItem[];
  onEdit: (item: TripScheduleItem) => void;
  onDelete: (id: string) => void;
  onLocationTap: (location: string, title: string) => void;
  /** その日を初期値にして「予定を追加」を開く。 */
  onAddForDate: (date: string) => void;
}

/**
 * 日程は1日=1枚のカードにする。以前は日付も「予定はまだありません」も、背景の写真の上に
 * 文字だけで置いていたため、明るい写真の日は文字が沈んでほとんど読めなかった。
 * 他の一覧(ルート・費用)と同じく面の上に載せて、日付・件数・その日の予定をまとめて見せる。
 *
 * 予定が無い日は1行の「予定を追加」に畳む。9日間の旅行だと空の日が縦に積み上がって
 * 延々スクロールすることになるため、空の日ほど小さく収まるようにしてある。
 */
export function TripScheduleList({ dayList, items, onEdit, onDelete, onLocationTap, onAddForDate }: Props) {
  if (dayList.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">旅行の日程を先に設定してください</p>;
  }

  return (
    <div className="trip-day-list">
      {dayList.map((date, i) => {
        const dayItems = items
          .filter((it) => it.date === date)
          .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

        return (
          <section key={date} className={`trip-day${dayItems.length === 0 ? " trip-day--empty" : ""}`}>
            <header className="trip-day__head">
              <span className="trip-day__index" aria-hidden="true">
                {i + 1}
              </span>
              <h3>
                {i + 1}日目<span>・{formatDisplayDate(date)}</span>
              </h3>
              {dayItems.length > 0 && <b>{dayItems.length}件</b>}
            </header>
            {dayItems.length === 0 ? (
              <button type="button" className="trip-day__add" onClick={() => onAddForDate(date)}>
                <Plus size={14} />
                予定を追加
              </button>
            ) : (
              <div className="space-y-2">
                {dayItems.map((item) => {
                  const typeDef = getTripScheduleType(item.type);
                  return (
                    <ListRow key={item.id} interactive className="p-0">
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        aria-label={`${item.title}を編集`}
                        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      />
                      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3 p-3.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {item.startTime && (
                              <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs text-slate-400">
                                <Clock size={12} />
                                {item.endTime ? `${item.startTime}〜${item.endTime}` : item.startTime}
                              </span>
                            )}
                            <p className="line-clamp-2 text-sm font-medium text-slate-900" title={item.title}>
                              {item.title}
                            </p>
                          </div>
                          {item.location && (
                            <button
                              type="button"
                              onClick={() => onLocationTap(item.location!, item.title)}
                              className="pointer-events-auto mt-1 flex items-center gap-1 text-xs text-accent active:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            >
                              <MapPin size={12} />
                              {item.location}
                            </button>
                          )}
                          <div className="mt-1.5">
                            <Badge tone={typeDef.tone}>{typeDef.label}</Badge>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (item.id && confirm(`「${item.title}」を削除しますか?`)) onDelete(item.id);
                          }}
                          aria-label="削除"
                          className="pointer-events-auto shrink-0 rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </ListRow>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
