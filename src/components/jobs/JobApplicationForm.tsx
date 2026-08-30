import { useState } from "react";
import { Building2, CalendarClock, StickyNote } from "lucide-react";
import { db } from "../../db/schema";
import type { JobApplication, JobApplicationStage } from "../../types";
import { JOB_STAGES, jobEventTitle } from "../../lib/jobApplications";
import { Button } from "../ui/Button";
import { DateField } from "../ui/DateField";
import { Field } from "../ui/Field";
import { FormActions } from "../ui/FormActions";
import { FormPanel } from "../ui/FormPanel";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { SwitchField } from "../ui/SwitchField";
import { useToast } from "../ui/ToastProvider";

interface Props {
  initial?: JobApplication;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * 応募先の追加・編集。予定表との結びつきは「ゆるく」— 次の予定日を入れたときに
 * カレンダーへ入れるかどうかを選べるだけで、入れた後は普通の予定として扱う
 * (応募先を消しても予定は残る)。作った予定のidだけ覚えて、二重に作らないようにする。
 */
export function JobApplicationForm({ initial, onSaved, onCancel }: Props) {
  const showToast = useToast();
  const [companyName, setCompanyName] = useState(initial?.companyName ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [stage, setStage] = useState<JobApplicationStage>(initial?.stage ?? "applied");
  const [nextDate, setNextDate] = useState(initial?.nextDate ?? "");
  const [nextTime, setNextTime] = useState(initial?.nextTime ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  // すでに予定へ入れてあるものは、既定で入れ直さない(同じ予定が増えるのを防ぐ)。
  const [addToCalendar, setAddToCalendar] = useState(false);
  const [saving, setSaving] = useState(false);

  const alreadyLinked = Boolean(initial?.linkedEventId);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!companyName.trim() || saving) return;

    // 編集で開いたのに更新先のidが無い場合は止める(EventFormと同じ考え方) —
    // ここで追加に流すと、直したつもりの応募先が増えていく。
    if (initial && !initial.id) {
      showToast("この応募先の更新先が見つかりませんでした。増えてしまうのを防ぐため保存を中止しました", "error");
      return;
    }

    setSaving(true);
    const record: JobApplication = {
      companyName: companyName.trim(),
      role: role.trim() || undefined,
      stage,
      nextDate: nextDate || undefined,
      nextTime: nextDate && nextTime ? nextTime : undefined,
      memo: memo.trim() || undefined,
      linkedEventId: initial?.linkedEventId,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (addToCalendar && record.nextDate) {
      const eventId = await db.calendarEvents.add({
        title: jobEventTitle(record),
        date: record.nextDate,
        allDay: !record.nextTime,
        startTime: record.nextTime,
        category: "important",
        memo: record.role ? `${record.role}の選考` : undefined,
        createdAt: Date.now(),
      });
      record.linkedEventId = String(eventId);
    }

    if (initial?.id) await db.jobApplications.update(initial.id, record);
    else await db.jobApplications.add(record);

    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="どこに応募したか" icon={Building2}>
        <Input
          label="会社名"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="例: 株式会社ABC"
          required
          autoFocus
        />
        <Input
          label="職種"
          optional
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="例: Webエンジニア"
        />
        <Select label="今の段階" value={stage} onChange={(e) => setStage(e.target.value as JobApplicationStage)}>
          {JOB_STAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormPanel>

      <FormPanel caption="次の予定" icon={CalendarClock}>
        <DateField
          label="日付"
          optional
          value={nextDate}
          onChange={setNextDate}
          placeholder="まだ決まっていない"
        />
        {nextDate && (
          <Field label="時刻" optional as="div">
            <input
              type="time"
              aria-label="次の予定の時刻"
              className="field-shell"
              value={nextTime}
              onChange={(e) => setNextTime(e.target.value)}
            />
          </Field>
        )}
        {nextDate && (
          <SwitchField
            label="カレンダーにも予定として入れる"
            hint={
              alreadyLinked
                ? "この応募先はすでに予定に入れてあります。入れると、もう1件増えます。"
                : "「会社名 段階」という予定を作ります。作った予定は普通の予定として直せます。"
            }
            checked={addToCalendar}
            onChange={setAddToCalendar}
          />
        )}
      </FormPanel>

      <FormPanel caption="メモ" icon={StickyNote}>
        <Textarea
          label="メモ"
          optional
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
          placeholder="例: 面接はオンライン。担当は人事の田中さん。"
        />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          やめる
        </Button>
        <Button type="submit" className="flex-1" disabled={!companyName.trim() || saving}>
          保存する
        </Button>
      </FormActions>
    </form>
  );
}
