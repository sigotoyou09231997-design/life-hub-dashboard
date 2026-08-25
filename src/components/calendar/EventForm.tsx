import { useMemo, useState } from "react";
import { CalendarDays, Tag, Users } from "lucide-react";
import { db } from "../../db/schema";
import type { CalendarEvent, ScheduleCategory } from "../../types";
import { SCHEDULE_CATEGORIES } from "../../lib/scheduleCategories";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { SegmentedField } from "../ui/SegmentedField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { SwitchField } from "../ui/SwitchField";
import { useToast } from "../ui/ToastProvider";
import {
  addEventToAccount,
  emptyDrafts,
  followMainTitle,
  listOtherAccounts,
  planAccountEvents,
  type AccountEventDraft,
} from "../../lib/crossAccountEvents";

interface Props {
  initial?: CalendarEvent;
  defaultDate: string;
  onSaved: () => void;
  onCancel: () => void;
}

const NOTIFY_OPTIONS = [
  { value: "", label: "通知しない" },
  { value: "5", label: "5分前" },
  { value: "10", label: "10分前" },
  { value: "30", label: "30分前" },
  { value: "60", label: "1時間前" },
  { value: "1440", label: "前日" },
];

const SPAN_OPTIONS = [
  { value: "timed", label: "時間を決める" },
  { value: "allday", label: "終日" },
];

export function EventForm({ initial, defaultDate, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [category, setCategory] = useState<ScheduleCategory>(initial?.category ?? "other");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [notify, setNotify] = useState(initial?.notifyMinutesBefore?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  // 同じ端末に登録した、いま開いていない方のアカウント(src/lib/accounts.ts)。
  // 新規作成の時だけ複製先として出す — 既にある予定を編集するたびに、また相手側へ
  // 増えていくのはさすがにおかしいため。
  const otherAccounts = useMemo(() => (initial ? [] : listOtherAccounts()), [initial]);
  const [drafts, setDrafts] = useState<Record<string, AccountEventDraft>>(() =>
    emptyDrafts(initial ? [] : listOtherAccounts(), initial?.title ?? ""),
  );

  function handleTitleChange(next: string) {
    setTitle(next);
    // まだ個別に書き換えていない行は、上のタイトルに追従させる。
    setDrafts((current) => followMainTitle(current, next));
  }

  function updateDraft(userId: string, changes: Partial<AccountEventDraft>) {
    setDrafts((current) => ({ ...current, [userId]: { ...current[userId], ...changes } }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: CalendarEvent = {
      title: title.trim(),
      date,
      allDay,
      startTime: allDay ? undefined : startTime || undefined,
      endTime: allDay ? undefined : endTime || undefined,
      category,
      location: location || undefined,
      memo: memo || undefined,
      // All-day events have no clock time to count down from, so a
      // time-based notification can never fire correctly — drop it
      // rather than storing a value that silently does nothing.
      notifyMinutesBefore: allDay || !notify ? undefined : Number(notify),
      notifiedAt: undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.calendarEvents.update(initial.id, record);
    } else {
      await db.calendarEvents.add(record);
      // ほかのアカウントにも入れる分。1つ失敗しても残りは続け、こちらのアカウントに
      // 入れた予定は必ず残す — 相手側への複製のために本体を巻き添えにしない。
      const failed: string[] = [];
      for (const planned of planAccountEvents(otherAccounts, drafts, record.title)) {
        try {
          await addEventToAccount(planned.account, { ...record, title: planned.title });
        } catch (error) {
          console.error("[crossAccountEvents] failed to add an event to another account:", error);
          failed.push(planned.account.label);
        }
      }
      if (failed.length > 0) {
        showToast(`${failed.join("・")}には予定を入れられませんでした`, "error");
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何の予定" icon={CalendarDays}>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="例: 歯医者"
          required
          autoFocus
        />
      </FormPanel>

      <FormPanel caption="いつ">
        <DateField label="日付" value={date} onChange={setDate} />
        <SegmentedField
          label="時間"
          value={allDay ? "allday" : "timed"}
          options={SPAN_OPTIONS}
          onChange={(value) => setAllDay(value === "allday")}
        />
        {!allDay && (
          <Field label="開始 → 終了" as="div">
            <div className="range-field range-field--time">
              <input
                type="time"
                aria-label="開始時刻"
                className="field-shell"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <span className="range-field__arrow" aria-hidden="true">
                〜
              </span>
              <input
                type="time"
                aria-label="終了時刻"
                className="field-shell"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </Field>
        )}
        {!allDay && (
          <Select label="通知" value={notify} onChange={(e) => setNotify(e.target.value)}>
            {NOTIFY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </FormPanel>

      <FormPanel caption="そのほか" icon={Tag}>
        <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value as ScheduleCategory)}>
          {SCHEDULE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          label="場所"
          optional
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="例: 駅前クリニック"
        />
        <Textarea label="メモ" optional value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
      </FormPanel>

      {otherAccounts.length > 0 && (
        <FormPanel caption="ほかのアカウントにも入れる" icon={Users}>
          {otherAccounts.map((account) => (
            <div key={account.userId}>
              <SwitchField
                label={account.label}
                hint={account.email ?? undefined}
                checked={drafts[account.userId]?.checked ?? false}
                onChange={(checked) => updateDraft(account.userId, { checked })}
              />
              {drafts[account.userId]?.checked && (
                <Input
                  label="このアカウントでの予定名"
                  value={drafts[account.userId].title}
                  onChange={(e) => updateDraft(account.userId, { title: e.target.value, edited: true })}
                  placeholder={title || "例: 面接"}
                />
              )}
            </div>
          ))}
        </FormPanel>
      )}

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "予定を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
