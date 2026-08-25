import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, TriangleAlert } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail, TripScheduleType } from "../../types";
import { extractTripPlanFromEmail } from "../../lib/gmail";
import {
  PLAN_DESTINATIONS,
  describePlanImportError,
  isOutsideTrip,
  pickDefaultTripId,
  sortTripsForPicker,
  toCalendarEventRecord,
  toImportRows,
  toTaskRecord,
  toTripExpenseRecord,
  toTripScheduleRecord,
  type PlanDestination,
  type TripImportRow,
} from "../../lib/mailPlanImport";
import { TRIP_SCHEDULE_TYPES } from "../../lib/tripCategories";
import { formatShortDate } from "../../lib/date";
import { Sheet } from "../ui/Sheet";
import { Tabs } from "../ui/Tabs";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { SwitchField } from "../ui/SwitchField";
import { DateField } from "../ui/DateField";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/ToastProvider";

interface Props {
  email: SyncedEmail;
  account: GmailAccount;
  open: boolean;
  onClose: () => void;
}

/** メールの内容を、旅行の日程・予定・タスクのどれかに入れる画面。
 *
 * 読み取りはAI(netlify/functions/extractTripPlan.ts)だが、結果をそのまま保存はしない —
 * 日付や時刻の読み違いがそのまま入ると、当日それを信じて動いてしまうため、必ずここで
 * 確認・修正してから入れる。 */
export function MailPlanImport({ email, account, open, onClose }: Props) {
  const showToast = useToast();
  // 並べ替えはJS側で行う(src/lib/mailPlanImport.ts の sortTripsForPicker)。tripsの索引は
  // id だけなので、Dexieに orderBy("startDate") を頼むと例外になる。
  const trips = useLiveQuery(async () => sortTripsForPicker(await db.trips.toArray()), []);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<TripImportRow[]>([]);
  const [destination, setDestination] = useState<PlanDestination>("trip");
  const [tripId, setTripId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // 開いた時に1回だけ読み取る。閉じたら状態を捨てて、次に開いた時はやり直す
  // (失敗した時は開き直せば再試行になる方が分かりやすい)。
  //
  // 「読み取り済みか」をstateではなくrefで持ち、依存配列にも入れないのが要点。
  // status を依存に入れていた頃は、setStatus("loading") で自分自身を再実行させて
  // 後片付け(active=false)が走り、返ってきた結果を捨てて「読み取っています…」の
  // まま固まっていた。account/emailもidだけを見る — 元は同期のたびに作り直される
  // オブジェクトで、中身が同じでも再実行の引き金になるため。
  const startedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setStatus("idle");
      setRows([]);
      setError("");
      setTripId(undefined);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;
    setStatus("loading");
    void (async () => {
      try {
        const items = await extractTripPlanFromEmail(account, email);
        if (!active) return;
        setRows(toImportRows(items));
        setStatus("ready");
      } catch (err) {
        if (!active) return;
        console.error("[mailPlanImport] failed to read a plan from the email:", err);
        setError(describePlanImportError(err));
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, email.id, account.id]);

  // 読み取った日付に合う旅行を初期値にする。旅行が増えるほど毎回選び直すのは面倒なので。
  useEffect(() => {
    if (status !== "ready" || !trips || tripId !== undefined) return;
    setTripId(pickDefaultTripId(trips, rows));
  }, [status, trips, rows, tripId]);

  const selectedTrip = trips?.find((trip) => trip.id === tripId);
  const checkedRows = rows.filter((row) => row.checked);
  // 旅行の日程に入れる時だけ、入れ先の旅行が要る。予定・タスクはそのまま入れられる。
  const missingTrip = destination === "trip" && !tripId;

  function updateRow(index: number, changes: Partial<TripImportRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  async function handleSave() {
    if (checkedRows.length === 0 || missingTrip) return;
    setSaving(true);
    try {
      const now = Date.now();
      for (const row of checkedRows) {
        if (destination === "trip") {
          await db.tripSchedule.add(toTripScheduleRecord(row, tripId!, now));
          // 費用は旅行にだけあるもの。金額が読み取れていて、外されていない分だけ積む。
          if (row.withExpense && row.amount) await db.tripExpenses.add(toTripExpenseRecord(row, tripId!, now));
        } else if (destination === "event") {
          await db.calendarEvents.add(toCalendarEventRecord(row, now));
        } else {
          await db.tasks.add(toTaskRecord(row, now));
        }
      }
      const label = PLAN_DESTINATIONS.find((d) => d.value === destination)?.label ?? "";
      showToast(`${checkedRows.length}件を${label}に入れました`);
      onClose();
    } catch (err) {
      console.error("[mailPlanImport] failed to save:", err);
      showToast("入れられませんでした", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="このメールから予定を作る">
      {status === "loading" && (
        <p className="py-8 text-center text-sm text-slate-500" role="status" aria-live="polite">
          メールから予定を読み取っています…
        </p>
      )}

      {status === "error" && (
        <div className="space-y-3 py-4">
          <p className="text-sm text-slate-600">メールから予定を読み取れませんでした。</p>
          {/* 何が起きたか分からないままだと直しようがないので、理由はそのまま出す。 */}
          <p className="break-all text-xs leading-relaxed text-slate-500">{error}</p>
          <Button type="button" variant="secondary" className="w-full" onClick={onClose}>
            閉じる
          </Button>
        </div>
      )}

      {status === "ready" && rows.length === 0 && (
        <EmptyState
          icon={CalendarPlus}
          title="予定になりそうな内容は見つかりませんでした"
          description="日付や時間が書かれたメールを開いてからお試しください"
        />
      )}

      {status === "ready" && rows.length > 0 && (
        <div className="space-y-4">
          <Tabs
            options={PLAN_DESTINATIONS}
            value={destination}
            onChange={(value) => setDestination(value)}
          />

          {destination === "trip" &&
            (!trips || trips.length === 0 ? (
              <EmptyState
                icon={CalendarPlus}
                title="先に旅行を作ってください"
                description="旅行画面で行き先と日付を登録すると、ここから日程を入れられます"
              />
            ) : (
              <Select label="どの旅行に入れる" value={tripId ?? ""} onChange={(e) => setTripId(e.target.value)}>
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}（{formatShortDate(trip.startDate)}〜{formatShortDate(trip.endDate)}）
                  </option>
                ))}
              </Select>
            ))}

          <div className="space-y-3">
            {rows.map((row, index) => {
              const outside = destination === "trip" && isOutsideTrip(selectedTrip, row.date);
              return (
                <div key={index} className="glass-row space-y-2 rounded-xl p-3">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) => updateRow(index, { checked: e.target.checked })}
                      aria-label={`${row.title}を入れる`}
                      className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--hub-accent,#4f6fff)]"
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{row.title}</span>
                  </label>

                  {row.checked && (
                    <div className="space-y-2">
                      <Input
                        label={destination === "task" ? "やること" : "内容"}
                        value={row.title}
                        onChange={(e) => updateRow(index, { title: e.target.value })}
                      />
                      <DateField
                        label={destination === "task" ? "期限" : "日付"}
                        value={row.date}
                        onChange={(date) => updateRow(index, { date })}
                      />
                      <Field label="時刻" as="div">
                        <input
                          type="time"
                          aria-label="時刻"
                          className="field-shell"
                          value={row.startTime ?? ""}
                          onChange={(e) => updateRow(index, { startTime: e.target.value })}
                        />
                      </Field>
                      {/* 種類は旅行の日程だけが持つ項目。 */}
                      {destination === "trip" && (
                        <Select
                          label="種類"
                          value={row.type}
                          onChange={(e) => updateRow(index, { type: e.target.value as TripScheduleType })}
                        >
                          {TRIP_SCHEDULE_TYPES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      )}
                      {destination !== "task" && (
                        <Input
                          label="場所"
                          optional
                          value={row.location ?? ""}
                          onChange={(e) => updateRow(index, { location: e.target.value })}
                        />
                      )}
                      {/* 費用は旅行の日程に入れる時だけ。新幹線なら交通費、宿なら宿泊費として
                          同じ旅行に積む(種類がそのまま費用の分類になる)。 */}
                      {destination === "trip" && (
                        <>
                          <SwitchField
                            label="費用にも入れる"
                            hint={row.amount ? undefined : "メールから金額を読み取れませんでした"}
                            checked={row.withExpense}
                            onChange={(withExpense) => updateRow(index, { withExpense })}
                          />
                          {row.withExpense && (
                            <Input
                              label="金額"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={row.amount != null ? String(row.amount) : ""}
                              onChange={(e) =>
                                updateRow(index, { amount: e.target.value ? Number(e.target.value) : undefined })
                              }
                              placeholder="例: 12540"
                            />
                          )}
                        </>
                      )}
                      {row.memo && <p className="px-1 text-xs leading-relaxed text-slate-500">{row.memo}</p>}
                      {outside && (
                        <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-warning">
                          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                          この旅行の期間の外です。入れても日程表には出てこないので、日付か旅行の期間を直してください
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={saving || missingTrip || checkedRows.length === 0}
            >
              {checkedRows.length}件を入れる
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
