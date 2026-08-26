import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, Check, MapPin, TriangleAlert } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail, TripScheduleType } from "../../types";
import { extractTripPlanFromEmail } from "../../lib/gmail";
import {
  PLAN_DESTINATIONS,
  PLAN_GROUPS,
  TRIP_SECTIONS,
  describePlanImportError,
  isAlreadyRegistered,
  isOutsideTrip,
  isRouteAlreadyRegistered,
  needsTrip,
  nextRouteSortOrder,
  planKey,
  pickDefaultTripId,
  routeKey,
  sortTripsForPicker,
  toCalendarEventRecord,
  toDestination,
  toImportRows,
  toRouteImportRows,
  toTaskRecord,
  toTripExpenseRecord,
  toTripRoutePlaceRecord,
  toTripScheduleRecord,
  type PlanGroup,
  type RouteImportRow,
  type TripImportRow,
  type TripSection,
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

/** メールの内容を、旅行の日程・旅行のルート・予定・タスクのどれかに入れる画面。
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
  /** ルートに入れる時の行。日程とは別に持つ — 1本の移動が出発地と到着地の2地点になるので、
   * 日程の行と1対1にはならない。 */
  const [routeRows, setRouteRows] = useState<RouteImportRow[]>([]);
  // 上段のタブ(旅行計画/予定/タスク)と、旅行計画を選んだ時の中身(日程/ルート)。
  // 実際の入れ先はこの2つから決まる。予定・タスクへ行って戻ってきても、旅行計画の
  // 中でどちらを見ていたかは覚えておく。
  const [group, setGroup] = useState<PlanGroup>("trip");
  const [tripSection, setTripSection] = useState<TripSection>("trip");
  const destination = toDestination(group, tripSection);
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
      setRouteRows([]);
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
        setRouteRows(toRouteImportRows(items));
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

  // 入れ先に既にある分の「鍵」。日付・時刻・タイトルが一致するものは、同じ内容として
  // 二重に入れない。入れ先(と旅行)を切り替えるたびに引き直す。
  const existingKeys = useLiveQuery(async () => {
    // ルートは日付ではなく場所で見分けるので、下の routePlaces 側で判定する。
    if (destination === "route") return new Set<string>();
    if (destination === "trip") {
      if (!tripId) return new Set<string>();
      const items = await db.tripSchedule.where("tripId").equals(tripId).toArray();
      return new Set(items.map((item) => planKey(item.date, item.startTime, item.title)));
    }
    if (destination === "event") {
      const events = await db.calendarEvents.toArray();
      return new Set(events.map((event) => planKey(event.date, event.startTime, event.title)));
    }
    const tasks = await db.tasks.toArray();
    return new Set(tasks.map((task) => planKey(task.dueDate ?? "", task.dueTime, task.title)));
  }, [destination, tripId]);

  // ルートに入れる時だけ、その旅行に今入っている場所を読む。重複の判定と、末尾に足す
  // 順番(sortOrder)の両方に要る。
  const routePlaces = useLiveQuery(async () => {
    if (destination !== "route" || !tripId) return [];
    return db.tripRoutePlaces.where("tripId").equals(tripId).toArray();
  }, [destination, tripId]);
  const existingRouteKeys = routePlaces ? new Set(routePlaces.map((place) => routeKey(place.address))) : undefined;

  const selectedTrip = trips?.find((trip) => trip.id === tripId);
  /** 既に入っている行は、チェックが付いていても入れない。状態そのものは書き換えず、
   * ここで弾く — 入れ先を切り替えた途端にチェックが消えると、何が起きたか分からないため。 */
  const checkedRows = rows.filter((row) => row.checked && !isAlreadyRegistered(row, existingKeys));
  /** 住所が空の場所は地図が迷子になるので入れない(ルート画面の入力欄と同じ決まり)。 */
  const checkedRouteRows = routeRows.filter(
    (row) => row.checked && row.name.trim() && row.address.trim() && !isRouteAlreadyRegistered(row, existingRouteKeys),
  );
  const savableCount = destination === "route" ? checkedRouteRows.length : checkedRows.length;
  // 旅行の日程・ルートに入れる時だけ、入れ先の旅行が要る。予定・タスクはそのまま入れられる。
  const missingTrip = needsTrip(destination) && !tripId;

  function updateRow(index: number, changes: Partial<TripImportRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  function updateRouteRow(index: number, changes: Partial<RouteImportRow>) {
    setRouteRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  async function handleSave() {
    if (savableCount === 0 || missingTrip) return;
    setSaving(true);
    try {
      const now = Date.now();
      if (destination === "route") {
        // 回る順は、いま入っている場所の後ろに読み取った順で足す。並べ替えはルート画面でできる。
        let sortOrder = nextRouteSortOrder(routePlaces ?? []);
        for (const row of checkedRouteRows) {
          await db.tripRoutePlaces.add(toTripRoutePlaceRecord(row, tripId!, sortOrder, now));
          sortOrder += 1;
        }
      } else {
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
      }
      const label = PLAN_DESTINATIONS.find((d) => d.value === destination)?.label ?? "";
      showToast(`${savableCount}件を${label}に入れました`);
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
          <Tabs options={PLAN_GROUPS} value={group} onChange={(value) => setGroup(value)} />

          {/* 旅行計画の中のどこに入れるか。上段と同じ重さで並べないよう、見出し付きの
              小さいタブにする(CSV取り込みの「金額の形式」と同じ形)。 */}
          {group === "trip" && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-600">旅行計画のどこに入れる</span>
              <Tabs options={TRIP_SECTIONS} value={tripSection} onChange={(value) => setTripSection(value)} dense />
            </div>
          )}

          {needsTrip(destination) &&
            (!trips || trips.length === 0 ? (
              <EmptyState
                icon={CalendarPlus}
                title="先に旅行を作ってください"
                description={
                  destination === "route"
                    ? "旅行画面で行き先と日付を登録すると、ここからルートに場所を入れられます"
                    : "旅行画面で行き先と日付を登録すると、ここから日程を入れられます"
                }
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

          {destination === "route" &&
            (routeRows.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="ルートに置ける場所は見つかりませんでした"
                description="駅・空港・ホテルなど、場所の名前が書かれたメールを開いてからお試しください"
              />
            ) : (
              <div className="space-y-3">
                {routeRows.map((row, index) => {
                  const already = isRouteAlreadyRegistered(row, existingRouteKeys);
                  const missingAddress = !row.address.trim();
                  return (
                    <div key={index} className={`glass-row space-y-2 rounded-xl p-3 ${already ? "opacity-70" : ""}`}>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={row.checked && !already}
                          disabled={already}
                          onChange={(e) => updateRouteRow(index, { checked: e.target.checked })}
                          aria-label={`${row.name}を入れる`}
                          className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--hub-accent,#4f6fff)] disabled:opacity-50"
                        />
                        <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{row.name}</span>
                      </label>

                      {already && (
                        <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-success">
                          <Check size={13} className="mt-0.5 shrink-0" />
                          すでにこの旅行のルートに入っています
                        </p>
                      )}

                      {row.checked && !already && (
                        <div className="space-y-2">
                          <Input
                            label="場所の名前"
                            value={row.name}
                            onChange={(e) => updateRouteRow(index, { name: e.target.value })}
                          />
                          <Input
                            label="住所・場所"
                            value={row.address}
                            onChange={(e) => updateRouteRow(index, { address: e.target.value })}
                            hint="地図に渡す文字列です。駅名や施設名だけでも構いません。"
                          />
                          {/* どの移動・予約から来た場所かが分かるように、読み取り元をそのまま
                              メモとして持たせている(ルート画面のカードにも出る)。 */}
                          {row.memo && <p className="px-1 text-xs leading-relaxed text-slate-500">{row.memo}</p>}
                          {missingAddress && (
                            <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-warning">
                              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                              住所か場所の名前を入れてください。空のままでは地図が開けないので入れられません
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

          {destination !== "route" && (
            <div className="space-y-3">
              {rows.map((row, index) => {
                const outside = destination === "trip" && isOutsideTrip(selectedTrip, row.date);
                const already = isAlreadyRegistered(row, existingKeys);
                return (
                  <div key={index} className={`glass-row space-y-2 rounded-xl p-3 ${already ? "opacity-70" : ""}`}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={row.checked && !already}
                        disabled={already}
                        onChange={(e) => updateRow(index, { checked: e.target.checked })}
                        aria-label={`${row.title}を入れる`}
                        className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--hub-accent,#4f6fff)] disabled:opacity-50"
                      />
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{row.title}</span>
                    </label>

                    {already && (
                      <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-success">
                        <Check size={13} className="mt-0.5 shrink-0" />
                        すでに登録されています
                      </p>
                    )}

                    {row.checked && !already && (
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
                        <Field label={destination === "task" ? "時刻" : "開始 → 終了"} as="div">
                          {destination === "task" ? (
                            <input
                              type="time"
                              aria-label="時刻"
                              className="field-shell"
                              value={row.startTime ?? ""}
                              onChange={(e) => updateRow(index, { startTime: e.target.value })}
                            />
                          ) : (
                            // 予定フォーム(EventForm)と同じ並び。移動なら「10:05 〜 13:20」と
                            // 出るので、当日の動きが一目で分かる。
                            <div className="range-field range-field--time">
                              <input
                                type="time"
                                aria-label="開始時刻"
                                className="field-shell"
                                value={row.startTime ?? ""}
                                onChange={(e) => updateRow(index, { startTime: e.target.value })}
                              />
                              <span className="range-field__arrow" aria-hidden="true">
                                〜
                              </span>
                              <input
                                type="time"
                                aria-label="終了時刻"
                                className="field-shell"
                                value={row.endTime ?? ""}
                                onChange={(e) => updateRow(index, { endTime: e.target.value })}
                              />
                            </div>
                          )}
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
          )}

          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={saving || missingTrip || savableCount === 0}
            >
              {savableCount}件を入れる
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
