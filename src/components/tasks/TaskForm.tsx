import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Clock, MapPin, Repeat } from "lucide-react";
import { db } from "../../db/schema";
import type { Task, Priority, RepeatRule, ScheduleCategory } from "../../types";
import { SCHEDULE_CATEGORIES } from "../../lib/scheduleCategories";
import {
  EMPTY_PLACE_REMINDER_DRAFT,
  loadPlaceReminderDraft,
  savePlaceReminderDraft,
  type PlaceReminderDraft,
} from "../../lib/placeReminders";
import { PlaceReminderField } from "../reminders/PlaceReminderField";
import { Input } from "../ui/Input";
import { SegmentedField } from "../ui/SegmentedField";
import { RepeatField } from "../calendar/RepeatField";
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

/** 通知の選択肢。値と名前は予定の画面(EventForm)と同じ — ただしタスクには「前日」は今までも無いので足さない。
 * プルダウンにしないのは、iPhone ではシートの中のプルダウンを押すとキーボードが閉じてシートが動き、
 * 選択肢が欄から離れた所に出て、押したつもりが外れるため(2026-10-12。2026-10-11の持ち物と同じ直し方)。 */
const NOTIFY_OPTIONS = [
  { value: "", label: "通知しない" },
  { value: "5", label: "5分前" },
  { value: "10", label: "10分前" },
  { value: "30", label: "30分前" },
  { value: "60", label: "1時間前" },
];

/** 保存する値は今までのプルダウンと同じ(category の文字列そのまま)。予定の画面と同じ並び・名前。 */
const CATEGORY_OPTIONS = SCHEDULE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }));

export function TaskForm({ initial, parentTaskId, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? "");
  const [notify, setNotify] = useState(initial?.notifyMinutesBefore?.toString() ?? "");
  const [repeat, setRepeat] = useState<RepeatRule>(initial?.repeat ?? "none");
  const [category, setCategory] = useState<ScheduleCategory>(initial?.category ?? "other");
  const [placeReminder, setPlaceReminder] = useState<PlaceReminderDraft>(EMPTY_PLACE_REMINDER_DRAFT);
  const [saving, setSaving] = useState(false);
  // 選択肢に無い分数(ほかの経路で入った値)のタスクを開いた時も、その値を見えるように1つ足す
  // (EventForm と同じ)。開いた時の値で決める — 今の値で決めると、ほかを押した途端に消えて戻せなくなる。
  const notifyOptions = useMemo(() => {
    const original = initial?.notifyMinutesBefore?.toString();
    return original && !NOTIFY_OPTIONS.some((o) => o.value === original)
      ? [...NOTIFY_OPTIONS, { value: original, label: `${original}分前` }]
      : NOTIFY_OPTIONS;
  }, [initial?.notifyMinutesBefore]);

  // 場所リマインドはタスクの行と別のテーブルにあるので、開いたときに読み直す
  // (src/lib/placeReminders.ts)。
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    loadPlaceReminderDraft("task", initialId).then((draft) => {
      if (alive) setPlaceReminder(draft);
    });
    return () => {
      alive = false;
    };
  }, [initialId]);

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

    // 新しいタスクにはまだidが無く、リマインドの貼り先を決められない。保存して得た
    // idに向けて、そのあとで書く(src/lib/placeReminders.ts)。
    let taskId: string;
    if (initial?.id) {
      taskId = initial.id;
      await db.tasks.update(taskId, record);
    } else {
      taskId = String(await db.tasks.add(record));
    }
    await savePlaceReminderDraft("task", taskId, placeReminder);
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
        <SegmentedField label="通知" value={notify} options={notifyOptions} onChange={setNotify} columns={3} separate />
      </FormPanel>

      <FormPanel caption="場所で知らせる" icon={MapPin}>
        <PlaceReminderField value={placeReminder} onChange={setPlaceReminder} />
      </FormPanel>

      <FormPanel caption="繰り返しと分類" icon={Repeat}>
        <RepeatField value={repeat} onChange={setRepeat} />
        <SegmentedField<ScheduleCategory>
          label="カテゴリ"
          value={category}
          options={CATEGORY_OPTIONS}
          onChange={setCategory}
          columns={2}
          separate
        />
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
