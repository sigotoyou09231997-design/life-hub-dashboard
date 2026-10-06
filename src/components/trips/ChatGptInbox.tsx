import { useEffect, useState } from "react";
import { Inbox, Trash2 } from "lucide-react";
import { deleteInboxEntry, loadInbox, type InboxEntry } from "../../lib/chatgptInbox";
import { Button } from "../ui/Button";

interface Props {
  /** 「読み込む」を押した旅程。呼び出し側が、読み取りと同じ確認画面に並べる。 */
  onPick: (entry: InboxEntry) => void;
}

/** "2026-12-27" → "12/27"。 */
function monthDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function periodLabel(entry: InboxEntry): string | undefined {
  if (!entry.startDate) return undefined;
  if (!entry.endDate || entry.endDate === entry.startDate) return monthDay(entry.startDate);
  return `${monthDay(entry.startDate)}〜${monthDay(entry.endDate)}`;
}

function receivedLabel(receivedAt: number): string {
  if (!Number.isFinite(receivedAt)) return "";
  const d = new Date(receivedAt);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}に受信`;
}

/**
 * 専用GPTから届いた旅程の一覧(src/lib/chatgptInbox.ts)。1件も無ければ何も出さない。
 *
 * 画面を開いた時と、アプリに戻ってきた時に読み直す — ChatGPT のタブで送ったあと、
 * このタブへ戻った時点で届いているのが見えるようにするため。
 * 「読み込む」は日程に入れるのではなく、確認画面に並べるだけ(入れるのは本人)。
 */
export function ChatGptInbox({ onPick }: Props) {
  const [entries, setEntries] = useState<InboxEntry[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadInbox().then((next) => {
        if (active) setEntries(next);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (entries.length === 0) return null;

  async function handleDelete(id: string) {
    try {
      await deleteInboxEntry(id);
      setEntries((current) => current.filter((entry) => entry.id !== id));
    } catch (err) {
      console.error("[chatgptInbox] failed to delete an entry:", err);
    }
  }

  return (
    <section className="space-y-2" aria-label="ChatGPTから届いた旅程">
      <p className="flex items-center gap-2 px-1 text-sm font-medium text-slate-700">
        <Inbox size={16} />
        ChatGPTから届いた旅程
      </p>
      <ul className="space-y-2">
        {entries.map((entry) => {
          const meta = [periodLabel(entry), `${entry.items.length}件`, receivedLabel(entry.receivedAt)].filter(Boolean).join(" ・ ");
          return (
            <li key={entry.id} className="flex items-center gap-2 border border-white/60 bg-white/40 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{entry.tripName ?? "名前のない旅程"}</p>
                <p className="text-xs text-slate-500">{meta}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => onPick(entry)}>
                読み込む
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`「${entry.tripName ?? "名前のない旅程"}」を受信箱から消す`} onClick={() => handleDelete(entry.id)}>
                <Trash2 size={16} />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
