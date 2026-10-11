import { useEffect, useState } from "react";
import { db } from "../../db/schema";
import type { TripExpense, TripScheduleItem, TripScheduleType, TripTransportMode } from "../../types";
import { toExpenseCategory } from "../../lib/mailPlanImport";
import { deleteCurrencyFor } from "../../lib/currency";
import { TRIP_SCHEDULE_TYPES, TRIP_TRANSPORT_MODES } from "../../lib/tripCategories";
import { SegmentedField, type SegmentedOption } from "../ui/SegmentedField";
import { TRANSPORT_MODE_ICON } from "./transportModes";
import { ChevronDown, ImagePlus, MapPinned } from "lucide-react";
import { detailsForSave, hasScheduleDetails, type ScheduleDetailField } from "../../lib/scheduleDetails";
import { loadAttachmentDrafts, saveAttachmentDrafts, type PhotoDraft } from "../../lib/attachments";
import { PhotoField } from "../attachments/PhotoField";
import { AmountInput, Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { DateRangeField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";
import { isMultiDay, normalizeEndDate, shiftEndDate, spanDays } from "../../lib/eventSpan";

interface Props {
  tripId: string;
  initial?: TripScheduleItem;
  /** 旅行の参加者。いれば、予定の費用の「支払った人」を選べる(src/lib/tripMembers.ts)。 */
  members?: string[] | null;
  defaultDate: string;
  /** 保存した予定の日(開始日)。旅行の画面が、その日へ表示を切り替えるのに使う。 */
  onSaved: (date: string) => void;
  onCancel: () => void;
}

/** 「未定」は空の値。選び直して消せるように、手段と同じ並びに置く。 */
const TRANSPORT_OPTIONS: SegmentedOption<TripTransportMode | "">[] = [
  ...TRIP_TRANSPORT_MODES.map((mode) => ({ value: mode.value, label: mode.label, icon: TRANSPORT_MODE_ICON[mode.value] })),
  { value: "", label: "未定" },
];

export function TripScheduleForm({ tripId, initial, members: membersProp, defaultDate, onSaved, onCancel }: Props) {
  // 同期で降りてきた旅行は、参加者の列が空だと null になる。引数の既定値(= [])は undefined にしか
  // 効かないので、ここで空にそろえる(2026-10-11、null のまま .length を読んで予定を押すと真っ白になった)。
  const members = membersProp ?? [];
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  /** 終了日。宿泊のように何日かにまたがるものだけ入れる(空＝その日で終わる)。 */
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [type, setType] = useState<TripScheduleType>(initial?.type ?? "sightseeing");
  /** 何で移動するか。種類が「移動」の時だけ出して、保存する。 */
  const [transportMode, setTransportMode] = useState<TripTransportMode | "">(initial?.transportMode ?? "");
  // 詳細(住所・電話・URL・営業時間・チェックイン/アウト)。ふだんは畳み、どれかが入っている予定では開いて出す。
  const [details, setDetails] = useState<Record<ScheduleDetailField, string>>({
    address: initial?.address ?? "",
    phone: initial?.phone ?? "",
    url: initial?.url ?? "",
    openingHours: initial?.openingHours ?? "",
    checkInTime: initial?.checkInTime ?? "",
    checkOutTime: initial?.checkOutTime ?? "",
  });
  const [detailsOpen, setDetailsOpen] = useState(() => hasScheduleDetails(initial));
  const setDetail = (field: ScheduleDetailField) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDetails((current) => ({ ...current, [field]: event.target.value }));
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  // この予定の費用(TripExpense.scheduleId がこの予定)。金額を入れると作り、消すと消す。費用タブにも出る。
  const [linkedExpense, setLinkedExpense] = useState<TripExpense>();
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [saving, setSaving] = useState(false);

  // 貼ってある写真は別のテーブルにあるので、開いた時に読み直す(書類・メモ・日記と同じ。src/lib/attachments.ts)。
  // この予定の費用も、費用の表にあるので一緒に読む。
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    loadAttachmentDrafts("tripSchedule", initialId).then((drafts) => {
      if (alive) setPhotos(drafts);
    });
    void db.tripExpenses
      .where("tripId")
      .equals(tripId)
      .filter((expense) => expense.scheduleId === initialId)
      .first()
      .then((expense) => {
        if (!alive || !expense) return;
        setLinkedExpense(expense);
        setAmount(String(expense.amount));
        setPaidBy(expense.paidBy ?? "");
      });
    return () => {
      alive = false;
    };
  }, [initialId, tripId]);

  // 参加者から外した人が払っていた費用も、その名前のまま選べるように残す。
  const payerOptions = linkedExpense?.paidBy && !members.includes(linkedExpense.paidBy) ? [...members, linkedExpense.paidBy] : members;

  /** 予定の費用を、入れた金額に合わせる(作る・書き換える・消す)。 */
  async function saveLinkedExpense(scheduleId: string, scheduleTitle: string) {
    const yen = Math.round(Number(amount));
    if (!amount.trim() || !Number.isFinite(yen) || yen <= 0) {
      if (linkedExpense?.id) {
        await db.tripExpenses.delete(linkedExpense.id);
        await deleteCurrencyFor(linkedExpense.id);
      }
      return;
    }
    if (linkedExpense?.id) {
      await db.tripExpenses.update(linkedExpense.id, { amount: yen, paidBy: paidBy || undefined, title: scheduleTitle });
      return;
    }
    await db.tripExpenses.add({
      tripId,
      title: scheduleTitle,
      amount: yen,
      category: toExpenseCategory(type),
      paidDate: date,
      paid: Boolean(paidBy),
      paidBy: paidBy || undefined,
      scheduleId,
      createdAt: Date.now(),
    });
  }

  /** 開始日を動かしたら、終了日も同じ日数ぶん一緒に動かす(src/lib/eventSpan.ts)。 */
  function changeDate(next: string) {
    setEndDate((current) => shiftEndDate(date, next, current));
    setDate(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: TripScheduleItem = {
      tripId,
      date,
      endDate: normalizeEndDate(date, endDate),
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      title: title.trim(),
      location: location || undefined,
      memo: memo || undefined,
      type,
      transportMode: type === "transport" && transportMode ? transportMode : undefined,
      ...detailsForSave(type, details),
      createdAt: initial?.createdAt ?? Date.now(),
    };

    // 新しい予定にはまだ id が無く、写真の貼り先を決められない。保存して得た id に向けて、あとで写真を書く。
    let scheduleId: string;
    if (initial?.id) {
      scheduleId = initial.id;
      await db.tripSchedule.update(initial.id, record);
    } else {
      scheduleId = String(await db.tripSchedule.add(record));
    }
    await saveAttachmentDrafts("tripSchedule", scheduleId, photos);
    await saveLinkedExpense(scheduleId, record.title);
    setSaving(false);
    onSaved(date);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何をする" icon={MapPinned}>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 五稜郭"
          required
          autoFocus
        />
        <Select label="種類" value={type} onChange={(e) => setType(e.target.value as TripScheduleType)}>
          {TRIP_SCHEDULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        {type === "transport" && (
          <SegmentedField
            label="移動手段"
            optional
            value={transportMode}
            options={TRANSPORT_OPTIONS}
            onChange={setTransportMode}
            columns={5}
            stacked
          />
        )}
      </FormPanel>

      <FormPanel caption="いつ・どこで">
        <DateRangeField
          label="日付"
          start={date}
          end={endDate}
          onChangeStart={changeDate}
          onChangeEnd={setEndDate}
          endPlaceholder="同じ日に終わる"
          advanceToEnd={false}
          summaryText={
            isMultiDay({ date, endDate })
              ? `${spanDays({ date, endDate })}日間・その間の日すべての日程に出ます`
              : ""
          }
        />
        <Input
          label="開始時刻"
          optional
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        {/* 移動なら到着時刻。メールから取り込んだ分もここで直せる。 */}
        <Input
          label="終了時刻"
          optional
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
        />
        <Input
          label="場所"
          optional
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="例: 函館市元町"
        />
        <Textarea label="メモ" optional value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
      </FormPanel>

      <FormPanel caption="詳細">
        <button
          type="button"
          className="flex w-full items-center justify-between px-[0.9rem] py-3 text-left text-sm text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span>{type === "lodging" ? "住所・電話・URL・チェックイン/アウト" : "住所・電話・URL・営業時間"}</span>
          <ChevronDown size={16} className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {detailsOpen && (
          <>
            <Input label="住所" optional value={details.address} onChange={setDetail("address")} placeholder="例: 徳島県鳴門市鳴門町土佐泊浦字大毛264-1" />
            <Input label="電話番号" optional type="tel" inputMode="tel" value={details.phone} onChange={setDetail("phone")} placeholder="例: 088-687-0613" />
            <Input label="URL" optional type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={details.url} onChange={setDetail("url")} placeholder="例: https://www.uzusio.com" />
            {type === "lodging" ? (
              <>
                <Input label="チェックイン" optional type="time" value={details.checkInTime} onChange={setDetail("checkInTime")} />
                <Input label="チェックアウト" optional type="time" value={details.checkOutTime} onChange={setDetail("checkOutTime")} />
              </>
            ) : (
              <Input label="営業時間" optional value={details.openingHours} onChange={setDetail("openingHours")} placeholder="例: 9:00〜16:30(水曜休み)" />
            )}
          </>
        )}
      </FormPanel>

      <FormPanel caption="費用">
        <AmountInput label="金額" optional value={amount} onChange={(e) => setAmount(e.target.value)} min={0} placeholder="0" />
        {payerOptions.length > 0 ? (
          <Select label="支払った人" optional value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">決めていない</option>
            {payerOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="px-[0.9rem] py-2.5 text-xs text-slate-400">旅行の編集で参加者を入れると、誰が払ったかも選べます。</p>
        )}
      </FormPanel>

      <FormPanel caption="写真" icon={ImagePlus}>
        <PhotoField value={photos} onChange={setPhotos} />
      </FormPanel>

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
