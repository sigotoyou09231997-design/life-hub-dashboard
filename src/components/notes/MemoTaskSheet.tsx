import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { db } from "../../db/schema";
import { splitMemoTasks } from "../../lib/memoTasks";
import { deleteTaskCascade } from "../../lib/undoableDeletes";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormActions";
import { Sheet } from "../ui/Sheet";
import { showUndoToast } from "../ui/undoToast";

interface Props {
  open: boolean;
  onClose: () => void;
  /** メモの題名と本文。本文を1行ずつの候補にわけて見せる。 */
  title: string;
  body: string;
  /** 「題名だけを1件にする」(今までの「タスク化」)。 */
  onTitleOnly: () => void;
}

/**
 * 箇条書きのメモを、1行ずつのタスクにまとめて入れる(第73弾)。
 * 入れる前に必ず一覧で確かめさせる(Claude が変更を入れる前に承認を求めるのと同じ。読み違いがそのまま入らないように)。
 * 入れたら「元に戻す」で、今入れた分だけをまとめて消せる。
 */
export function MemoTaskSheet({ open, onClose, title, body, onTitleOnly }: Props) {
  const lines = splitMemoTasks(body);
  const [picked, setPicked] = useState<Set<string>>(new Set(lines));
  const [saving, setSaving] = useState(false);

  // 開くたびに、全部選んだ状態から始める(前に外した行を引きずらない)。
  useEffect(() => {
    if (open) setPicked(new Set(splitMemoTasks(body)));
  }, [open, body]);

  const chosen = lines.filter((line) => picked.has(line));

  function toggle(line: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  async function handleSave() {
    if (chosen.length === 0 || saving) return;
    setSaving(true);
    try {
      const now = Date.now();
      const ids: string[] = [];
      for (const [index, line] of chosen.entries()) {
        ids.push(
          String(await db.tasks.add({ title: line, priority: "medium", completed: false, repeat: "none", createdAt: now + index })),
        );
      }
      onClose();
      showUndoToast(`${ids.length}件のタスクにしました`, async () => {
        for (const id of ids) await deleteTaskCascade(id);
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="タスクにまとめる">
      <p className="px-1 pb-2 text-xs text-slate-500">
        「{title}」の中の行を、1行ずつタスクにします。入れない行は、タップで外してください。
      </p>
      <ul className="grid gap-2" aria-label="タスクにする行">
        {lines.map((line) => {
          const on = picked.has(line);
          return (
            <li key={line}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(line)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${
                  on ? "border-accent/40 bg-accent-light text-slate-900" : "border-slate-200 bg-white text-slate-400"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    on ? "border-accent bg-accent text-white" : "border-slate-300"
                  }`}
                >
                  {on && <Check size={13} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 break-words">{line}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          onClose();
          onTitleOnly();
        }}
        className="mt-3 w-full rounded-lg px-2 py-2 text-xs text-slate-500 active:bg-slate-100"
      >
        行ごとではなく、「{title.length > 14 ? `${title.slice(0, 14)}…` : title}」の1件だけにする
      </button>
      <FormActions>
        <Button type="button" variant="secondary" onClick={onClose}>
          やめる
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={chosen.length === 0} loading={saving}>
          {chosen.length}件をタスクにする
        </Button>
      </FormActions>
    </Sheet>
  );
}
