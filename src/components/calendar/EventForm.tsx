import { useEffect, useMemo, useState } from "react";
import type { UpdateSpec } from "dexie";
import { CalendarDays, Tag, Users } from "lucide-react";
import { db } from "../../db/schema";
import type { CalendarEvent, RepeatRule, ScheduleCategory } from "../../types";
import { SCHEDULE_CATEGORIES } from "../../lib/scheduleCategories";
import { EventPeopleField } from "./EventPeopleField";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { SegmentedField } from "../ui/SegmentedField";
import { DateField, DateRangeField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { SwitchField } from "../ui/SwitchField";
import { isMultiDay, normalizeEndDate, shiftEndDate, spanDays } from "../../lib/eventSpan";
import { isRepeating } from "../../lib/repeatRule";
import { RepeatField } from "./RepeatField";
import { useToast } from "../ui/ToastProvider";
import {
  applyEventToAccount,
  emptyDrafts,
  findLinkedEvent,
  followMainTitle,
  listOtherAccounts,
  planAccountChanges,
  removeEventFromAccount,
  type AccountEventDraft,
} from "../../lib/crossAccountEvents";

interface Props {
  initial?: CalendarEvent;
  defaultDate: string;
  /** 既存の予定を更新したのか、新しく1件足したのかを呼び出し側へ伝える。
   * 「編集したのに新しい予定として増える」不具合を、画面の文言で切り分けられるようにする。 */
  onSaved: (mode: "created" | "updated") => void;
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
  // 終了日は「何日かにまたがる予定」だけが持つ。空欄＝その日で終わる(src/lib/eventSpan.ts)。
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [category, setCategory] = useState<ScheduleCategory>(initial?.category ?? "other");
  // 「誰の予定か」。カテゴリとは別の軸で、こちらは何人でも付けられる(src/lib/eventPeople.ts)。
  const [personIds, setPersonIds] = useState<string[]>(initial?.personIds ?? []);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [notify, setNotify] = useState(initial?.notifyMinutesBefore?.toString() ?? "");
  const [repeat, setRepeat] = useState<RepeatRule>(initial?.repeat ?? "none");
  const [repeatUntil, setRepeatUntil] = useState(initial?.repeatUntil ?? "");
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  // 同じ端末に登録した、いま開いていない方のアカウント(src/lib/accounts.ts)。
  // 新規作成でも編集でも出す — 作る時に入れ忘れた予定を、後から相手のアカウントへ
  // 入れられるようにするため。既定はオフなので、編集して保存し直しただけで勝手に
  // 増えることはない。
  const otherAccounts = useMemo(() => listOtherAccounts(), []);
  const [drafts, setDrafts] = useState<Record<string, AccountEventDraft>>(() =>
    emptyDrafts(listOtherAccounts(), initial?.title ?? ""),
  );

  // 編集で開いた予定が、既にどのアカウントへ入っているかを見に行く。入っていれば
  // スイッチを入れた状態にし、そのアカウントで付けている予定名をそのまま出す —
  // ここで拾わないと、保存のたびに相手側へ同じ予定が積み上がる。
  useEffect(() => {
    const linkId = initial?.linkId;
    if (!linkId || otherAccounts.length === 0) return;
    let active = true;
    void (async () => {
      const found = await Promise.all(
        otherAccounts.map(async (account) => {
          try {
            return { account, event: await findLinkedEvent(account, linkId) };
          } catch (error) {
            // 相手のDBを開けなくても、この画面は開けたままにする(入っていない扱い)。
            console.error("[crossAccountEvents] failed to look up a linked event:", error);
            return { account, event: null };
          }
        }),
      );
      if (!active) return;
      setDrafts((current) => {
        const next = { ...current };
        for (const { account, event } of found) {
          if (!event) continue;
          // 相手側で付けている名前は上のタイトルに追従させない(editedを立てる)。
          next[account.userId] = { checked: true, title: event.title, edited: true, existed: true };
        }
        return next;
      });
    })();
    return () => {
      active = false;
    };
  }, [initial?.linkId, otherAccounts]);

  /**
   * 開始日を動かしたら、終了日も同じ日数ぶん動かす。3泊の宿泊を1日ずらしたいだけなのに
   * 終了日まで入れ直すのは手間だし、開始日より前に取り残されると期間が消えてしまう。
   */
  function handleDateChange(next: string) {
    setEndDate((current) => shiftEndDate(date, next, current));
    setDate(next);
  }

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

    // 編集で開いたのに更新先のidが無い場合は、何もしないで止める。ここで下の分岐に
    // 落とすと「追加」になり、直したつもりの予定が増えていく — 保存できない方が、
    // 気付かないうちに増え続けるよりずっとましなので、はっきり失敗させる。
    if (initial && !initial.id) {
      showToast("この予定の更新先が見つかりませんでした。増えてしまうのを防ぐため保存を中止しました", "error");
      return;
    }

    setSaving(true);
    const record: CalendarEvent = {
      title: title.trim(),
      date,
      endDate: normalizeEndDate(date, endDate),
      allDay,
      startTime: allDay ? undefined : startTime || undefined,
      endTime: allDay ? undefined : endTime || undefined,
      category,
      // 全員外した時も空の配列のまま渡す。undefinedにすると同期に載る行から項目ごと
      // 消え、Supabase側では「その列は触っていない」扱いになるので、外した操作が
      // ほかの端末に伝わらない(src/lib/sync.ts の rowToSnake は undefined を飛ばす)。
      personIds,
      location: location || undefined,
      memo: memo || undefined,
      // All-day events have no clock time to count down from, so a
      // time-based notification can never fire correctly — drop it
      // rather than storing a value that silently does nothing.
      notifyMinutesBefore: allDay || !notify ? undefined : Number(notify),
      notifiedAt: undefined,
      repeat,
      repeatUntil: repeat === "none" ? undefined : repeatUntil || undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    const changes = planAccountChanges(otherAccounts, drafts, record.title);
    // 印(linkId)は、ほかのアカウントに関わる時だけ持たせる。1つのアカウントにしか
    // 無い予定にまで付けても意味が無い。
    //
    // 印がまだ無い予定には、その予定自身のidを印として使う。ここで毎回新しい印を
    // 作っていた頃は、同じ予定を編集するたびに別の印になり、相手側の「同じ予定」を
    // 見つけられず新しく足し続けていた(印が付く前に作った予定で必ず起きる)。
    // idは変わらないので、何度編集しても同じ印になる。
    const needsLink = changes.apply.length > 0 || changes.remove.length > 0;
    const linkId =
      initial?.linkId ?? initial?.id ?? (needsLink ? crypto.randomUUID() : undefined);
    const stored: CalendarEvent = { ...record, linkId };

    const mode = initial?.id ? "updated" : "created";
    if (initial?.id) {
      // Dexieのupdateの型は「personIds.0」のような添字つきの鍵も受けられるように
      // 書かれていて、配列を持つ行をまるごと渡す形はそのままでは通らない。ここで
      // 渡しているのは行の置き換えそのもので意図どおりなので、型だけ合わせる。
      await db.calendarEvents.update(initial.id, stored as UpdateSpec<CalendarEvent>);
    } else {
      await db.calendarEvents.add(stored);
    }

    // ほかのアカウントの分。同じ印の予定が相手側にあればそれを直し、無ければ足す。
    // チェックを外した分は取り下げる。1つ失敗しても残りは続け、こちらのアカウントの
    // 予定は必ず残す — 相手側への反映のために本体を巻き添えにしない。
    const failed: string[] = [];
    if (linkId) {
      for (const planned of changes.apply) {
        try {
          await applyEventToAccount(planned.account, stored, linkId, planned.title);
        } catch (error) {
          console.error("[crossAccountEvents] failed to apply an event to another account:", error);
          failed.push(planned.account.label);
        }
      }
      for (const account of changes.remove) {
        try {
          await removeEventFromAccount(account, linkId);
        } catch (error) {
          console.error("[crossAccountEvents] failed to remove an event from another account:", error);
          failed.push(account.label);
        }
      }
    }
    if (failed.length > 0) {
      showToast(`${failed.join("・")}には反映できませんでした`, "error");
    }
    setSaving(false);
    onSaved(mode);
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
        <DateRangeField
          label="日付"
          start={date}
          end={endDate}
          onChangeStart={handleDateChange}
          onChangeEnd={setEndDate}
          endPlaceholder="同じ日に終わる"
          advanceToEnd={false}
          summaryText={
            isMultiDay({ date, endDate })
              ? `${spanDays({ date, endDate })}日間・かかっている日すべてに出ます`
              : ""
          }
        />
        <RepeatField value={repeat} onChange={setRepeat} />
        {isRepeating(repeat) && (
          <DateField
            label="繰り返しの終了日"
            optional
            value={repeatUntil}
            onChange={setRepeatUntil}
            minDate={date}
            placeholder="指定しなければ約2年間続きます"
          />
        )}
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
        <EventPeopleField value={personIds} onChange={setPersonIds} />
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
          {initial && (
            <p className="px-[0.9rem] py-3 text-xs leading-relaxed text-slate-500">
              入れたアカウントの予定は、この予定を直すと一緒に直ります（予定名だけはそのまま保たれます）。
              外して保存すると、そのアカウントから取り下げます。
            </p>
          )}
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
