import { useState } from "react";
import { CheckSquare, Clock, Repeat } from "lucide-react";
import { db } from "../../db/schema";
import type { Task, Priority, RepeatRule, ScheduleCategory } from "../../types";
import { SCHEDULE_CATEGORIES } from "../../lib/scheduleCategories";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { SegmentedField } from "../ui/SegmentedField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  initial?: Task;
  parentTaskId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

const PRIORITY_OPTIONS = [
  { value: "high" as Priority, label: "高" },
  { value: "medium" as Priority, label: "中" },
  { value: "low" as Priority, label: "低" },
];

const REPEAT_OPTIONS = [
  { value: "none" as RepeatRule, label: "しない" },
  { value: "daily" as RepeatRule, label: "毎日" },
  { value: "weekly" as RepeatRule, label: "毎週" },
  { value: "monthly" as RepeatRule, label: "毎月" },
];

export function TaskForm({ initial, parentTaskId, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? "");
  const [notify, setNotify] = useState(initial?.notifyMinutesBefore?.toString() ?? "");
  const [repeat, setRepeat] = useState<RepeatRule>(initial?.repeat ?? "none");
  const [category, setCategory] = useState<ScheduleCategory>(initial?.category ?? "other");
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
      category,
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何をする" icon={CheckSquare}>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 健康診断の予約"
          required
          autoFocus
        />
        <SegmentedField label="優先度" value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
      </FormPanel>

      <FormPanel caption="いつまでに" icon={Clock}>
        <DateField
          label="期限日"
          optional
          value={dueDate}
          onChange={setDueDate}
          placeholder="期限なし"
        />
        <Input
          label="期限時刻"
          optional
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
        />
        <Select label="通知" value={notify} onChange={(e) => setNotify(e.target.value)}>
          <option value="">通知しない</option>
          <option value="5">5分前</option>
          <option value="10">10分前</option>
          <option value="30">30分前</option>
          <option value="60">1時間前</option>
        </Select>
      </FormPanel>

      <FormPanel caption="繰り返しと分類" icon={Repeat}>
        <SegmentedField label="繰り返し" value={repeat} options={REPEAT_OPTIONS} onChange={setRepeat} />
        <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value as ScheduleCategory)}>
          {SCHEDULE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "タスクを追加"}
        </Button>
      </FormActions>
    </form>
  );
}
