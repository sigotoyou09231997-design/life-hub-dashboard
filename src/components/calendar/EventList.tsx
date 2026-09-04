import { useLiveQuery } from "dexie-react-hooks";
import type { CalendarEvent } from "../../types";
import { db } from "../../db/schema";
import { PersonTags } from "./PersonTags";
import { CalendarClock, CalendarRange, Clock, MapPin, Trash2 } from "lucide-react";
import { spanLabel, spanTimeText } from "../../lib/eventSpan";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { getScheduleCategory } from "../../lib/scheduleCategories";
import { isRepeating, repeatLabel } from "../../lib/repeatRule";

interface Props {
  events: CalendarEvent[];
  onEdit: (e: CalendarEvent) => void;
  onDelete: (id: string) => void;
  emptyMessage?: string;
  /** 「その日」を見ている一覧(今日・カレンダーの選んだ日)ではその日付を渡す。
   * またがる予定に「2日目/3日」と出せる。日をまたいで並べる一覧では渡さない
   * (代わりに「9/27(日)〜9/29(火)」が出る)。 */
  onDate?: string;
}

export function EventList({ events, onEdit, onDelete, emptyMessage = "予定はありません", onDate }: Props) {
  // 「誰の予定か」の名前と色。1件ずつ引くとリストの行数だけ購読が増えるので、
  // ここで1回だけ引いて各行へ配る。空の早期returnより前に置くこと(フックの規則)。
  const people = useLiveQuery(() => db.eventPeople.toArray(), []) ?? [];

  if (events.length === 0) {
    return <EmptyState icon={CalendarClock} title={emptyMessage} />;
  }

  const sorted = [...events].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  return (
    <div className="space-y-2">
      {sorted.map((ev) => {
        const category = getScheduleCategory(ev.category);
        const span = spanLabel(ev, onDate);
        return (
          <ListRow key={ev.id} interactive className="p-0">
            <button
              type="button"
              onClick={() => onEdit(ev)}
              aria-label={`${ev.title}を編集`}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            />
            <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium text-slate-900" title={ev.title}>
                  {ev.title}
                </p>
                {/* 時刻・場所・カテゴリを1行にまとめる(以前はカテゴリだけ独立した行に
                    置いていて、1件あたり1行ぶん余計に高さを使っていた)。 */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {spanTimeText(ev, onDate)}
                  </span>
                  {span && (
                    <span className="flex items-center gap-1 whitespace-nowrap font-medium text-slate-500">
                      <CalendarRange size={12} />
                      {span}
                    </span>
                  )}
                  {ev.location && (
                    <span className="flex items-center gap-1">
                      <MapPin size={12} />
                      {ev.location}
                    </span>
                  )}
                  <Badge tone={category.tone}>{category.label}</Badge>
                  <PersonTags event={ev} people={people} />
                  {isRepeating(ev.repeat) && <Badge tone="accent">{repeatLabel(ev.repeat)}</Badge>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (ev.id && confirm(`「${ev.title}」を削除しますか?`)) onDelete(ev.id);
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
  );
}
