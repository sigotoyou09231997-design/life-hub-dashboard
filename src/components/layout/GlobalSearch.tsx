import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Search } from "lucide-react";
import { db } from "../../db/schema";
import { countHits, searchEverything, type SearchGroup } from "../../lib/globalSearch";
import { Sheet } from "../ui/Sheet";
import { Input } from "../ui/Input";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMPTY_GROUPS: SearchGroup[] = [];

/** 予定・タスク・メモ・旅行・Gmailを1か所からまとめて探す。各画面の個別検索は
 * そのまま残してあり、これは「どこに書いたか忘れた」ときのための追加の入口。 */
export function GlobalSearch({ open, onClose }: Props) {
  const [query, setQuery] = useState("");

  // 開き直すたびに前回の語が残っていると、まず消す操作から始まってしまう。
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // 探す語が入って初めて読む — 開いただけで全テーブルを読みにいかない。
  const source = useLiveQuery(async () => {
    if (query.trim().length === 0) return null;
    const [events, tasks, notes, trips, tripSchedule, emails] = await Promise.all([
      db.calendarEvents.toArray(),
      db.tasks.toArray(),
      db.notes.toArray(),
      db.trips.toArray(),
      db.tripSchedule.toArray(),
      db.syncedEmails.toArray(),
    ]);
    return { events, tasks, notes, trips, tripSchedule, emails };
  }, [query.trim().length === 0]);

  const groups = source ? searchEverything(query, source) : EMPTY_GROUPS;
  const total = countHits(groups);
  const searching = query.trim().length > 0;

  return (
    <Sheet open={open} onClose={onClose} title="まとめて検索">
      <div className="flex flex-col gap-4">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="店の名前、予定、メモなど"
          aria-label="まとめて検索"
          autoFocus
        />

        {!searching && (
          <p className="px-1 text-sm text-slate-500">
            予定・タスク・メモ・リスト・旅行・Gmailをまとめて探します。
          </p>
        )}

        {searching && source === undefined && <p className="px-1 text-sm text-slate-500">探しています…</p>}

        {searching && source !== undefined && total === 0 && (
          <EmptyState icon={Search} title="見つかりませんでした" description="別の言葉でも試してみてください。" />
        )}

        {groups.map((group) => (
          <section key={group.kind}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <p className="text-sm font-medium text-slate-600">{group.label}</p>
              <span className="text-xs text-slate-400">{group.hits.length}件</span>
            </div>
            <div className="space-y-2">
              {group.hits.map((hit) =>
                hit.external ? (
                  <a
                    key={hit.id}
                    href={hit.to}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass-row block rounded-xl p-3 text-left transition-colors active:bg-white/70"
                  >
                    <p className="truncate text-sm font-medium text-slate-900">{hit.title}</p>
                    {hit.subtitle && <p className="truncate text-xs text-slate-500">{hit.subtitle}</p>}
                  </a>
                ) : (
                  <Link
                    key={hit.id}
                    to={hit.to}
                    onClick={onClose}
                    className="glass-row block rounded-xl p-3 text-left transition-colors active:bg-white/70"
                  >
                    <p className="truncate text-sm font-medium text-slate-900">{hit.title}</p>
                    {hit.subtitle && <p className="truncate text-xs text-slate-500">{hit.subtitle}</p>}
                  </Link>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
