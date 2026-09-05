import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, Check, MapPin, TriangleAlert, Users } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail } from "../../types";
import { extractTripPlanFromEmail } from "../../lib/gmail";
import {
  PLAN_GROUPS,
  TRIP_SECTIONS,
  describeCounts,
  describePlanImportError,
  describeSaved,
  destinationLabel,
  isAlreadyRegistered,
  isOutsideTrip,
  isRouteAlreadyRegistered,
  needsTrip,
  nextRouteSortOrder,
  otherDestinations,
  planKey,
  pickDefaultTripId,
  routeKey,
  sortDestinations,
  sortTripsForPicker,
  toCalendarEventRecord,
  toDestination,
  toImportRows,
  toRouteImportRows,
  toTaskRecord,
  toTripExpenseRecord,
  toTripRoutePlaceRecord,
  toTripScheduleRecord,
  type PlanDestination,
  type PlanGroup,
  type RouteImportRow,
  type TripImportRow,
  type TripSection,
} from "../../lib/mailPlanImport";
import {
  applyEventToAccount,
  emptyDrafts,
  followMainTitle,
  listOtherAccounts,
  planAccountChanges,
  type AccountEventDraft,
} from "../../lib/crossAccountEvents";
import { formatShortDate } from "../../lib/date";
import { PlanImportRow } from "../plan/PlanImportRow";
import { Sheet } from "../ui/Sheet";
import { Tabs } from "../ui/Tabs";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { SwitchField } from "../ui/SwitchField";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormActions";
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
  /** タブの入れ先に加えて、同時に入れる先。「旅行の日程と予定の両方」のように、
   * 1通のメールを2か所に入れたい時のためのもの。タブを移ると、その入れ先ぶんは外す
   * (同じ所に二重に入れないため)。 */
  const [extras, setExtras] = useState<PlanDestination[]>([]);

  function changeGroup(next: PlanGroup) {
    setGroup(next);
    setExtras((current) => current.filter((d) => d !== toDestination(next, tripSection)));
  }

  function changeTripSection(next: TripSection) {
    setTripSection(next);
    setExtras((current) => current.filter((d) => d !== next));
  }
  const [tripId, setTripId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // この端末に登録した、いま開いていない方のアカウント(予定フォームと同じ仕組み)。
  // 面接の予定を、こちらには会社名入りで・相手には別の名前で入れられるようにする。
  const otherAccountsRef = useRef(listOtherAccounts());
  const otherAccounts = otherAccountsRef.current;
  const [accountDrafts, setAccountDrafts] = useState<Record<string, AccountEventDraft>>(() =>
    emptyDrafts(otherAccountsRef.current, ""),
  );

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
      setExtras([]);
      setError("");
      setTripId(undefined);
      setAccountDrafts(emptyDrafts(otherAccountsRef.current, ""));
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

  // 入れ先に既にある分の「鍵」。日付・時刻・タイトル(ルートは場所)が一致するものは、
  // 同じ内容として二重に入れない。まとめて入れられるようになったので、入れ先ごとに
  // 引くのではなく一度に全部引く — タブを見ていない入れ先でも重複を弾くため。
  // ルートの場所そのもの(places)は、末尾に足す順番(sortOrder)にも要る。
  const existing = useLiveQuery(async () => {
    const schedule = tripId ? await db.tripSchedule.where("tripId").equals(tripId).toArray() : [];
    const events = await db.calendarEvents.toArray();
    const tasks = await db.tasks.toArray();
    const places = tripId ? await db.tripRoutePlaces.where("tripId").equals(tripId).toArray() : [];
    return {
      trip: new Set(schedule.map((item) => planKey(item.date, item.startTime, item.title))),
      event: new Set(events.map((event) => planKey(event.date, event.startTime, event.title))),
      task: new Set(tasks.map((task) => planKey(task.dueDate ?? "", task.dueTime, task.title))),
      route: new Set(places.map((place) => routeKey(place.address))),
      places,
    };
  }, [tripId]);

  /** 日付で見分ける入れ先(日程・予定・タスク)の、既に入っている分の鍵。 */
  function keysFor(target: Exclude<PlanDestination, "route">): Set<string> | undefined {
    return existing?.[target];
  }

  const selectedTrip = trips?.find((trip) => trip.id === tripId);
  /** その入れ先に実際に入る行。既に入っている行は、チェックが付いていても入れない。
   * 状態そのものは書き換えず、ここで弾く — 入れ先を切り替えた途端にチェックが消えると、
   * 何が起きたか分からないため。同じ内容でも、入れ先ごとに「既にあるか」は違う。 */
  function rowsFor(target: Exclude<PlanDestination, "route">): TripImportRow[] {
    return rows.filter((row) => row.checked && !isAlreadyRegistered(row, keysFor(target)));
  }
  /** 住所が空の場所は地図が迷子になるので入れない(ルート画面の入力欄と同じ決まり)。 */
  const checkedRouteRows = routeRows.filter(
    (row) => row.checked && row.name.trim() && row.address.trim() && !isRouteAlreadyRegistered(row, existing?.route),
  );
  /** 今回入れる先。タブの入れ先と、「ほかにも入れる」で入にした先。 */
  const targets = sortDestinations([destination, ...extras]);
  /** 予定として入る行。ほかのアカウントに入れられるのは予定だけ(旅行の日程・タスクは
   * アカウントをまたぐ仕組みを持っていない)。 */
  const eventRows = targets.includes("event") ? rowsFor("event") : [];
  /** 1件だけ入れる時は、その内容をアカウントごとの予定名の初期値にする。複数入れる時は
   * どれの名前か決められないので、それぞれの内容のまま入れる。 */
  const singleEventTitle = eventRows.length === 1 ? eventRows[0].title : null;
  const showAccountPanel = otherAccounts.length > 0 && eventRows.length > 0;

  // 上の「内容」を打ち替えたら、まだ個別に書き換えていないアカウント欄も追従させる
  // (予定フォームと同じ。書き換えた行はそのまま残る)。
  useEffect(() => {
    if (singleEventTitle == null) return;
    setAccountDrafts((current) => followMainTitle(current, singleEventTitle));
  }, [singleEventTitle]);
  const counts = targets.map((target) => ({
    destination: target,
    // 旅行が決まっていない入れ先には入れられない(旅行が1つも無い時)。
    count: needsTrip(target) && !tripId ? 0 : target === "route" ? checkedRouteRows.length : rowsFor(target).length,
  }));
  const savableCount = counts.reduce((sum, entry) => sum + entry.count, 0);
  // 旅行の日程・ルートに入れる時だけ、入れ先の旅行が要る。予定・タスクはそのまま入れられる。
  const missingTrip = needsTrip(destination) && !tripId;

  /** 「ほかにも入れる」に並べる入れ先。入れようがないものは出さない —
   * 旅行が1つも無い時の日程・ルートと、場所が読み取れなかった時のルート。 */
  const extraOptions = otherDestinations(destination).filter((target) => {
    if (needsTrip(target) && !tripId) return false;
    if (target === "route" && routeRows.length === 0) return false;
    return true;
  });

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
      for (const target of targets) {
        if (needsTrip(target) && !tripId) continue;
        if (target === "route") {
          // 回る順は、いま入っている場所の後ろに読み取った順で足す。並べ替えはルート画面でできる。
          let sortOrder = nextRouteSortOrder(existing?.places ?? []);
          for (const row of checkedRouteRows) {
            await db.tripRoutePlaces.add(toTripRoutePlaceRecord(row, tripId!, sortOrder, now));
            sortOrder += 1;
          }
          continue;
        }
        for (const row of rowsFor(target)) {
          if (target === "trip") {
            await db.tripSchedule.add(toTripScheduleRecord(row, tripId!, now));
            // 費用は旅行にだけあるもの。金額が読み取れていて、外されていない分だけ積む。
            if (row.withExpense && row.amount) await db.tripExpenses.add(toTripExpenseRecord(row, tripId!, now));
          } else if (target === "event") {
            // 複数入れる時は、アカウントごとの予定名は使わずそれぞれの内容で入れる
            // (どの行の名前なのかを決められないため)。
            const drafts =
              singleEventTitle != null
                ? accountDrafts
                : Object.fromEntries(
                    Object.entries(accountDrafts).map(([userId, draft]) => [userId, { ...draft, title: "" }]),
                  );
            const changes = planAccountChanges(otherAccounts, drafts, row.title.trim());
            // 印(linkId)は、ほかのアカウントにも入れる時だけ持たせる。
            const linkId = changes.apply.length > 0 ? crypto.randomUUID() : undefined;
            const record = toCalendarEventRecord(row, now, linkId);
            await db.calendarEvents.add(record);
            for (const planned of changes.apply) {
              try {
                await applyEventToAccount(planned.account, record, linkId!, planned.title);
              } catch (error) {
                // 1つ失敗しても残りは続ける。こちらのアカウントには入っている。
                console.error("[mailPlanImport] failed to add the event to another account:", error);
              }
            }
          } else {
            await db.tasks.add(toTaskRecord(row, now));
          }
        }
      }
      showToast(describeSaved(counts));
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
          <Tabs options={PLAN_GROUPS} value={group} onChange={changeGroup} />

          {/* 旅行計画の中のどこに入れるか。上段と同じ重さで並べないよう、見出しを付けて
              一段下げる(CSV取り込みの「金額の形式」と同じ形)。タブそのものの大きさは
              アプリ中どこでも同じ(2026-09-05に一本化。src/components/ui/Tabs.tsx)。 */}
          {group === "trip" && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-600">旅行計画のどこに入れる</span>
              <Tabs options={TRIP_SECTIONS} value={tripSection} onChange={changeTripSection} />
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
                  const already = isRouteAlreadyRegistered(row, existing?.route);
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
                          className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-accent)] disabled:opacity-50"
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
              {rows.map((row, index) => (
                <PlanImportRow
                  key={index}
                  row={row}
                  destination={destination}
                  already={isAlreadyRegistered(row, keysFor(destination))}
                  outside={destination === "trip" && isOutsideTrip(selectedTrip, row.date)}
                  missingAmountHint="メールから金額を読み取れませんでした"
                  onChange={(changes) => updateRow(index, changes)}
                />
              ))}
            </div>
          )}

          {/* 予定として入れる時だけ出す。予定フォーム(EventForm)の同じ欄と揃えてある —
              こちらには会社名入りで、相手のアカウントには別の名前で置ける。 */}
          {showAccountPanel && (
            <div>
              <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-600">
                <Users size={14} />
                ほかのアカウントにも入れる
              </span>
              {singleEventTitle == null && (
                <p className="mb-1 px-1 text-xs leading-relaxed text-slate-500">
                  {eventRows.length}件まとめて入れるので、予定名はそれぞれの内容のまま入ります。
                </p>
              )}
              {otherAccounts.map((account) => (
                <div key={account.userId}>
                  <SwitchField
                    label={account.label}
                    hint={account.email ?? undefined}
                    checked={accountDrafts[account.userId]?.checked ?? false}
                    onChange={(checked) =>
                      setAccountDrafts((current) => ({
                        ...current,
                        [account.userId]: { ...current[account.userId], checked },
                      }))
                    }
                  />
                  {accountDrafts[account.userId]?.checked && singleEventTitle != null && (
                    <Input
                      label="このアカウントでの予定名"
                      value={accountDrafts[account.userId].title}
                      onChange={(e) =>
                        setAccountDrafts((current) => ({
                          ...current,
                          [account.userId]: { ...current[account.userId], title: e.target.value, edited: true },
                        }))
                      }
                      placeholder={singleEventTitle || "例: 面接"}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 1通のメールを2か所に入れたい時のためのもの(旅行の日程と予定、など)。
              入れ終わってから入れ直さずに済むよう、入れるボタンのすぐ上に置く。 */}
          {extraOptions.length > 0 && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-600">ほかにも入れる</span>
              {extraOptions.map((target) => (
                <SwitchField
                  key={target}
                  label={`${destinationLabel(target)}にも入れる`}
                  checked={extras.includes(target)}
                  onChange={(on) =>
                    setExtras((current) => (on ? [...current, target] : current.filter((d) => d !== target)))
                  }
                />
              ))}
            </div>
          )}

          {/* 2か所以上に入れる時は、どこに何件入るかを押す前に出す。 */}
          {targets.length > 1 && savableCount > 0 && (
            <p className="px-1 text-xs leading-relaxed text-slate-500">{describeCounts(counts)}</p>
          )}

          {/* シートの底に貼りつく操作(他のフォームと同じ FormActions)。読み取った件数が
              多いと画面に収まらず、最後までスクロールしないと押せなかった。 */}
          <FormActions>
            <Button type="button" variant="secondary" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving || missingTrip || savableCount === 0}>
              {targets.length > 1 ? `合計${savableCount}件を入れる` : `${savableCount}件を入れる`}
            </Button>
          </FormActions>
        </div>
      )}
    </Sheet>
  );
}
