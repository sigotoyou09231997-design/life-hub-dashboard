import { useLiveQuery } from "dexie-react-hooks";
import { ExternalLink, MapPin, Pencil, Trash2 } from "lucide-react";
import { db } from "../../db/schema";
import type { DiaryEntry, DiaryMood } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { groupByOwner } from "../../lib/attachments";
import { buildMapEmbedUrl, buildMapSearchUrl, coordsQuery } from "../../lib/googleMaps";
import { PhotoStrip } from "../attachments/PhotoStrip";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { useConfirm } from "../ui/ConfirmProvider";

interface Props {
  entries: DiaryEntry[];
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: string) => void;
}

const MOOD: Record<DiaryMood, { label: string; tone: "success" | "neutral" | "warning" }> = {
  good: { label: "よかった", tone: "success" },
  normal: { label: "ふつう", tone: "neutral" },
  bad: { label: "わるい", tone: "warning" },
};

function monthLabel(date: string): string {
  const [y, m] = date.split("-");
  return `${y}年${Number(m)}月`;
}

/** 月ごとにまとめる。日付だけを延々と積むと、どこまで遡ったのか分からない。
 *  見出しは列の外に出したいので、月の単位で切ってから中を並べる。 */
export function groupByMonth(entries: DiaryEntry[]): { label: string; items: DiaryEntry[] }[] {
  const groups: { label: string; items: DiaryEntry[] }[] = [];
  for (const entry of entries) {
    const label = monthLabel(entry.date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}

export function DiaryList({ entries, onEdit, onDelete }: Props) {
  // 日記に貼った写真。1件ずつ引くと並ぶ日記の数だけ問い合わせが増えるので、
  // 日記ぶんをまとめて読んでから配る(src/lib/attachments.ts)。
  const photos = useLiveQuery(() => db.attachments.where("ownerType").equals("diary").toArray(), []);
  const photosByEntry = groupByOwner(photos ?? []);
  const confirm = useConfirm();

  return (
    <div className="diary-board">
      {groupByMonth(entries).map((group) => (
        <section key={group.label}>
          <div data-page-block>
            <div className="trips-head diary-head">
              <h2>{group.label}</h2>
              <span>{group.items.length}</span>
            </div>
          </div>

          <div className="diary-grid mt-2.5">
            {group.items.map((entry) => {
              const spot =
                entry.latitude != null && entry.longitude != null
                  ? coordsQuery(entry.latitude, entry.longitude)
                  : null;

              return (
                <Card key={entry.id} className="diary-entry">
                  <header className="diary-entry__head">
                    <div>
                      <p className="diary-entry__date">{formatDisplayDate(entry.date)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {entry.mood && <Badge tone={MOOD[entry.mood].tone}>{MOOD[entry.mood].label}</Badge>}
                        {spot && (
                          <span className="diary-entry__place">
                            <MapPin size={12} />
                            {entry.placeLabel || "場所を記録"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="diary-entry__tools">
                      <button type="button" onClick={() => onEdit(entry)} aria-label={`${entry.date}の日記を編集`}>
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `${formatDisplayDate(entry.date)}の日記を削除しますか?`,
                          });
                          if (entry.id && ok) onDelete(entry.id);
                        }}
                        aria-label="削除"
                        className="diary-entry__remove"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </header>

                  <p className="diary-entry__body">{entry.body}</p>

                  <PhotoStrip attachments={photosByEntry.get(entry.id!) ?? []} interactive />

                  {spot && (
                    <div className="diary-entry__spot">
                      <div className="diary-entry__map">
                        <iframe
                          title={`${entry.date}に書いた場所の地図`}
                          src={buildMapEmbedUrl(spot)}
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                        />
                      </div>
                      <a href={buildMapSearchUrl(spot)} target="_blank" rel="noreferrer">
                        この場所をGoogleマップで開く
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
