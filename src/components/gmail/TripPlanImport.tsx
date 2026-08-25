import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plane, TriangleAlert } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail, TripScheduleType } from "../../types";
import { extractTripPlanFromEmail } from "../../lib/gmail";
import {
  isOutsideTrip,
  pickDefaultTripId,
  sortTripsForPicker,
  toImportRows,
  type TripImportRow,
} from "../../lib/tripImport";
import { TRIP_SCHEDULE_TYPES } from "../../lib/tripCategories";
import { formatShortDate } from "../../lib/date";
import { Sheet } from "../ui/Sheet";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
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

/** メールの予約内容を、旅行の日程表に入れる画面。
 *
 * 読み取りはAI(netlify/functions/extractTripPlan.ts)だが、結果をそのまま保存はしない —
 * 便名や時刻の読み違いがそのまま日程表に入ると、当日それを信じて動いてしまうため、
 * 必ずここで確認・修正してから入れる。 */
export function TripPlanImport({ email, account, open, onClose }: Props) {
  const showToast = useToast();
  // 並べ替えはJS側で行う(src/lib/tripImport.ts の sortTripsForPicker)。tripsの索引は
  // id だけなので、Dexieに orderBy("startDate") を頼むと例外になる。
  const trips = useLiveQuery(async () => sortTripsForPicker(await db.trips.toArray()), []);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<TripImportRow[]>([]);
  const [tripId, setTripId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // 開いた時に1回だけ読み取る。閉じたら状態を捨てて、次に開いた時はやり直す
  // (メールの内容は変わらないが、失敗した時に開き直せば再試行になる方が分かりやすい)。
  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setRows([]);
      setError("");
      return;
    }
    if (status !== "idle") return;
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
        console.error("[tripImport] failed to read a trip plan from the email:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [open, status, account, email]);

  // 読み取った日付に合う旅行を初期値にする。旅行が増えるほど毎回選び直すのは面倒なので。
  useEffect(() => {
    if (status !== "ready" || !trips || tripId !== undefined) return;
    setTripId(pickDefaultTripId(trips, rows));
  }, [status, trips, rows, tripId]);

  const selectedTrip = trips?.find((trip) => trip.id === tripId);
  const checkedRows = rows.filter((row) => row.checked);

  function updateRow(index: number, changes: Partial<TripImportRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  async function handleSave() {
    if (!tripId || checkedRows.length === 0) return;
    setSaving(true);
    try {
      for (const row of checkedRows) {
        await db.tripSchedule.add({
          tripId,
          date: row.date,
          startTime: row.startTime || undefined,
          title: row.title.trim(),
          location: row.location || undefined,
          memo: row.memo || undefined,
          type: row.type,
          createdAt: Date.now(),
        });
      }
      showToast(`${checkedRows.length}件を旅行の日程に入れました`);
      onClose();
    } catch (err) {
      console.error("[tripImport] failed to save the trip schedule:", err);
      showToast("日程に入れられませんでした", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="旅行の日程に入れる">
      {status === "loading" && (
        <p className="py-8 text-center text-sm text-slate-500" role="status" aria-live="polite">
          メールから日程を読み取っています…
        </p>
      )}

      {status === "error" && (
        <div className="space-y-3 py-4">
          <p className="text-sm text-slate-600">メールから日程を読み取れませんでした。</p>
          {/* 何が起きたか分からないままだと直しようがないので、理由はそのまま出す。 */}
          <p className="break-all text-xs leading-relaxed text-slate-500">{error}</p>
          <Button type="button" variant="secondary" className="w-full" onClick={onClose}>
            閉じる
          </Button>
        </div>
      )}

      {status === "ready" && rows.length === 0 && (
        <EmptyState
          icon={Plane}
          title="日程になりそうな予定は見つかりませんでした"
          description="予約確認や案内のメールを開いてからお試しください"
        />
      )}

      {status === "ready" && rows.length > 0 && (
        <div className="space-y-4">
          {!trips || trips.length === 0 ? (
            <EmptyState
              icon={Plane}
              title="先に旅行を作ってください"
              description="旅行画面で行き先と日付を登録すると、ここから日程を入れられます"
            />
          ) : (
            <>
              <Select label="どの旅行に入れる" value={tripId ?? ""} onChange={(e) => setTripId(e.target.value)}>
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}（{formatShortDate(trip.startDate)}〜{formatShortDate(trip.endDate)}）
                  </option>
                ))}
              </Select>

              <div className="space-y-3">
                {rows.map((row, index) => {
                  const outside = isOutsideTrip(selectedTrip, row.date);
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
                            label="内容"
                            value={row.title}
                            onChange={(e) => updateRow(index, { title: e.target.value })}
                          />
                          <DateField label="日付" value={row.date} onChange={(date) => updateRow(index, { date })} />
                          <Field label="時刻" as="div">
                            <input
                              type="time"
                              aria-label="時刻"
                              className="field-shell"
                              value={row.startTime ?? ""}
                              onChange={(e) => updateRow(index, { startTime: e.target.value })}
                            />
                          </Field>
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
                          <Input
                            label="場所"
                            optional
                            value={row.location ?? ""}
                            onChange={(e) => updateRow(index, { location: e.target.value })}
                          />
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
                  disabled={saving || !tripId || checkedRows.length === 0}
                >
                  {checkedRows.length}件を入れる
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
