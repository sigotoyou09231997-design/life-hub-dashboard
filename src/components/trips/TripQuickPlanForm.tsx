import { useState } from "react";
import { CalendarClock, MapPin, Wallet } from "lucide-react";
import { db } from "../../db/schema";
import type { TripExpenseCategory, TripScheduleType } from "../../types";
import { TRIP_EXPENSE_CATEGORIES, TRIP_SCHEDULE_TYPES } from "../../lib/tripCategories";
import { toExpenseCategory } from "../../lib/mailPlanImport";
import {
  buildTripQuickPlanRecords,
  describeTripQuickPlanSaved,
  hasTripQuickPlanError,
  validateTripQuickPlan,
  type TripQuickPlanInput,
} from "../../lib/tripQuickPlan";
import { Input, Textarea, AmountInput } from "../ui/Input";
import { Select } from "../ui/Select";
import { DateField } from "../ui/DateField";
import { SwitchField } from "../ui/SwitchField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  tripId: string;
  /** 日付の初期値。旅行中なら今日、そうでなければ初日(TripDetailPage が決める)。 */
  defaultDate: string;
  /** ルートの末尾に足すための順番。 */
  nextSortOrder: number;
  /** すでにルートに入っている場所の鍵。同じ場所を二重に並べないために渡す。 */
  existingRouteKeys: Set<string>;
  /** 入れた先を書いた知らせ文(「日程・費用に入れました」)を受け取る。 */
  onSaved: (message: string) => void;
  onCancel: () => void;
}

/**
 * 日程・費用・ルートを1回の入力でまとめて入れるフォーム。
 *
 * 「10時に五稜郭へ行く・入場料1200円・地図はここ」は本人にとって1つの出来事なのに、
 * これまでは日程タブ・費用タブ・ルートタブで3回、同じ日付と同じ場所を打ち直す必要が
 * あった。ここでは上の段で出来事そのものを書き、下の2つのスイッチで「費用にも」
 * 「ルートにも」を足す。スイッチを両方切れば、今まで通り日程が1件増えるだけになる。
 *
 * 直すときは今まで通り、それぞれのタブのフォームで直す — まとめて入れた後の3件は
 * 独立した行で、片方だけ直したい(金額だけ変わった等)ことの方が多いため。
 */
export function TripQuickPlanForm({ tripId, defaultDate, nextSortOrder, existingRouteKeys, onSaved, onCancel }: Props) {
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [memo, setMemo] = useState("");
  const [type, setType] = useState<TripScheduleType>("sightseeing");

  const [withExpense, setWithExpense] = useState(false);
  const [amount, setAmount] = useState("");
  /** 費用の分類。触るまでは日程の種類につられて動く(観光→観光、移動→交通)。
   * 一度自分で選んだら、その後は種類を変えても勝手に戻さない。 */
  const [expenseCategory, setExpenseCategory] = useState<TripExpenseCategory>(toExpenseCategory("sightseeing"));
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [paid, setPaid] = useState(false);

  const [withRoute, setWithRoute] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [routeAddress, setRouteAddress] = useState("");

  /** 送信を1度でも押すまでは赤字を出さない — 打ち始めた途端に「入れてください」が
   * 並ぶと、まだ書いていないだけなのに間違えたように見える。 */
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const input: TripQuickPlanInput = {
    date,
    startTime,
    endTime,
    title,
    location,
    memo,
    type,
    withExpense,
    amount: Number(amount) || undefined,
    expenseCategory,
    paid,
    withRoute,
    routeName,
    routeAddress,
  };
  const errors = submitted ? validateTripQuickPlan(input) : {};

  function changeType(next: TripScheduleType) {
    setType(next);
    if (!categoryTouched) setExpenseCategory(toExpenseCategory(next));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (hasTripQuickPlanError(validateTripQuickPlan(input))) return;

    setSaving(true);
    const records = buildTripQuickPlanRecords(input, {
      tripId,
      now: Date.now(),
      nextSortOrder,
      existingRouteKeys,
    });
    await db.tripSchedule.add(records.schedule);
    if (records.expense) await db.tripExpenses.add(records.expense);
    if (records.route) await db.tripRoutePlaces.add(records.route);
    setSaving(false);
    onSaved(describeTripQuickPlanSaved(records));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何をする" icon={CalendarClock}>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 五稜郭"
          error={errors.title}
          autoFocus
        />
        <Select label="種類" value={type} onChange={(e) => changeType(e.target.value as TripScheduleType)}>
          {TRIP_SCHEDULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <DateField label="日付" value={date} onChange={setDate} />
        <Input label="開始時刻" optional type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <Input label="終了時刻" optional type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        <Input
          label="場所"
          optional
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="例: 北海道函館市五稜郭町44"
          hint="ルートにも入れるときは、この場所がそのまま地図に渡ります。"
        />
        <Textarea label="メモ" optional value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
      </FormPanel>

      <FormPanel caption="費用にも入れる" icon={Wallet}>
        <SwitchField
          label="費用にも入れる"
          hint="支払日はこの日付になります"
          checked={withExpense}
          onChange={setWithExpense}
        />
        {withExpense && (
          <>
            <AmountInput
              label="金額"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={1}
              placeholder="0"
              error={errors.amount}
            />
            <Select
              label="分類"
              value={expenseCategory}
              onChange={(e) => {
                setCategoryTouched(true);
                setExpenseCategory(e.target.value as TripExpenseCategory);
              }}
            >
              {TRIP_EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <SwitchField label="支払い済み" checked={paid} onChange={setPaid} />
          </>
        )}
      </FormPanel>

      <FormPanel caption="ルートにも入れる" icon={MapPin}>
        <SwitchField
          label="ルートにも入れる"
          hint="回る順の最後に足します。何日目に回るかもこの日付になります"
          checked={withRoute}
          onChange={setWithRoute}
        />
        {withRoute && (
          <>
            <Input
              label="場所の名前"
              optional
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder={title || "例: 五稜郭"}
              hint="空のままなら、上のタイトルをそのまま使います。"
            />
            <Input
              label="住所・場所"
              optional
              value={routeAddress}
              onChange={(e) => setRouteAddress(e.target.value)}
              placeholder={location || "例: 北海道函館市五稜郭町44"}
              hint="空のままなら、上の「場所」をそのまま使います。"
              error={errors.routeAddress}
            />
          </>
        )}
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          まとめて追加
        </Button>
      </FormActions>
    </form>
  );
}
