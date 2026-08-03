import { useState } from "react";
import { db } from "../../db/schema";
import type { Task, Priority, RepeatRule } from "../../types";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";

interface Props {
  initial?: Task;
  parentTaskId?: number;
  onSaved: () => void;
  onCancel: () => void;
}

const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };
const REPEAT_LABEL: Record<RepeatRule, string> = {
  none: "繰り返さない",
  daily: "毎日",
  weekly: "毎週",
  monthly: "毎月",
};

export function TaskForm({ initial, parentTaskId, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? "");
  const [notify, setNotify] = useState(initial?.notifyMinutesBefore?.toString() ?? "");
  const [repeat, setRepeat] = useState<RepeatRule>(initial?.repeat ?? "none");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: Task = {
      title: title.trim(),
      priority,
      dueDate: dueDate || undefined,
      dueTime: dueTime || undefined,
      notifyMinutesBefore: notify ? Number(notify) : undefined,
      notifiedAt: undefined,
      completed: initial?.completed ?? false,
      completedAt: initial?.completedAt,
      parentTaskId: initial?.parentTaskId ?? parentTaskId,
      repeat,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.tasks.update(initial.id, record);
    } else {
      await db.tasks.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="タイトル" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">優先度</span>
        <div className="grid grid-cols-3 gap-2">
          {(["high", "medium", "low"] as Priority[]).map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setPriority(p)}
              className={`rounded-xl border py-2 text-sm font-medium transition-colors ${
                priority === p
                  ? "border-accent bg-accent-light text-accent"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="期限日" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <Input label="期限時刻" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
      </div>

      <Select label="通知" value={notify} onChange={(e) => setNotify(e.target.value)}>
        <option value="">通知しない</option>
        <option value="5">5分前</option>
        <option value="10">10分前</option>
        <option value="30">30分前</option>
        <option value="60">1時間前</option>
      </Select>

      <Select label="繰り返し" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatRule)}>
        {(["none", "daily", "weekly", "monthly"] as RepeatRule[]).map((r) => (
          <option key={r} value={r}>
            {REPEAT_LABEL[r]}
          </option>
        ))}
      </Select>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          保存する
        </Button>
      </div>
    </form>
  );
}
