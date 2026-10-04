import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, Loader2, Sparkles } from "lucide-react";
import { db } from "../../db/schema";
import type { Trip } from "../../types";
import { todayStr } from "../../lib/date";
import {
  describePlanImportError,
  findSimilarPlan,
  isAlreadyRegistered,
  isOutsideTrip,
  planKey,
  toImportRows,
  toTripExpenseRecord,
  toTripScheduleRecord,
  type TripImportRow,
} from "../../lib/mailPlanImport";
import { scanTripPlan } from "../../lib/tripPlanScan";
import { prepareImageForScan } from "../../lib/imageDownscale";
import { PlanImportRow } from "../plan/PlanImportRow";
import { ScanNotices } from "../plan/ScanNotices";
import { PlanSourceFields, usePickedPhotos } from "../plan/PlanSourceFields";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormActions";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  /** 入れ先の旅行のid。Trip.id は Dexie が振るまで空なので、他の旅行のフォームと
      同じように画面から確かなidを受け取る。 */
  tripId: string;
  /** 期間だけを見る(読み取った日付が旅行の外なら印を出す・「2日目」を実際の日付に直す)。 */
  trip: Trip;
  /** 入れ終わった時。知らせの文言を渡す。 */
  onSaved: (message: string) => void;
  onCancel: () => void;
}

type Status = "input" | "reading" | "ready" | "error";

/**
 * 旅行のしおり・チケット・案内のメッセージから、日程をまとめて起こす。
 *
 * 写真と文章のどちらからでも読める(両方まとめて渡してもよい)。読み取りは
 * Gmailの取り込みと同じサーバー関数(netlify/functions/extractTripPlan.ts)で、
 * 読み取った結果はそのまま保存せず、必ずここで確認・修正してから日程表に入れる —
 * 日付や時刻の読み違いがそのまま入ると、当日それを信じて動いてしまうため。
 */
export function TripPlanScanForm({ tripId, trip, onSaved, onCancel }: Props) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("input");
  const [error, setError] = useState("");
  const { photos, addPhotos, removePhoto, releasePhotos } = usePickedPhotos(setError);
  const [rows, setRows] = useState<TripImportRow[]>([]);
  // 全部は読み取れなかった時の断り。長い文章は日ごとに分けて読むので、その進み具合も持つ。
  const [notices, setNotices] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);

  // いま入っている日程。二重に入れないために2通りの見方をする —
  // 日付・時刻・タイトルが揃うものは入れさせず(メールの取り込みと同じ決まり)、
  // 同じ日の似たタイトルは、入れられるが既定では外しておく。
  const existingSchedule = useLiveQuery(
    async () => await db.tripSchedule.where("tripId").equals(tripId).toArray(),
    [tripId],
  );
  const existingKeys = existingSchedule
    ? new Set(existingSchedule.map((item) => planKey(item.date, item.startTime, item.title)))
    : undefined;

  const canRead = photos.length > 0 || text.trim().length > 0;

  async function handleRead() {
    if (!canRead) return;
    setStatus("reading");
    setError("");
    setProgress(null);
    try {
      // 送る前に縮める。スマホの写真をそのまま何枚も送ると、読み取りに行く前に
      // サーバーが受け取れる大きさを超える(src/lib/imageDownscale.ts)。
      const images = await Promise.all(photos.map((photo) => prepareImageForScan(photo.file)));
      const result = await scanTripPlan(
        {
          text,
          images,
          today: todayStr(),
          // 「2日目」のような書き方を実際の日付に直すために、入れ先の旅行の期間を渡す。
          tripStart: trip.startDate,
          tripEnd: trip.endDate,
        },
        (done, total) => setProgress({ done, total }),
      );
      setNotices(result.notices);
      // 同じ日に似た予定が既にあるものは、外した状態で並べる。読み取り直すたびに
      // 同じ予定が積み上がるのを、押す前に止めるため。
      setRows(
        toImportRows(result.items).map((row) =>
          findSimilarPlan(row, existingSchedule) ? { ...row, checked: false, withExpense: false } : row,
        ),
      );
      setStatus("ready");
    } catch (err) {
      console.error("[tripPlanScan] failed to read a plan:", err);
      setError(describePlanImportError(err));
      setStatus("error");
    }
  }

  function updateRow(index: number, changes: Partial<TripImportRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  /** 実際に入る行。既に同じ内容が入っているものは、チェックが付いていても入れない。 */
  const savableRows = rows.filter((row) => row.checked && !isAlreadyRegistered(row, existingKeys));
  const expenseCount = savableRows.filter((row) => row.withExpense && row.amount).length;

  async function handleSave() {
    if (savableRows.length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      for (const row of savableRows) {
        await db.tripSchedule.add(toTripScheduleRecord(row, tripId, now));
        // 費用は金額が読み取れていて、外されていない分だけ積む(種類がそのまま分類になる)。
        if (row.withExpense && row.amount) await db.tripExpenses.add(toTripExpenseRecord(row, tripId, now));
      }
      releasePhotos();
      onSaved(
        expenseCount > 0
          ? `日程に${savableRows.length}件、費用に${expenseCount}件入れました`
          : `日程に${savableRows.length}件入れました`,
      );
    } catch (err) {
      console.error("[tripPlanScan] failed to save:", err);
      setError("入れられませんでした。もう一度お試しください");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    releasePhotos();
    onCancel();
  }

  if (status === "reading") {
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status" aria-live="polite">
        <Loader2 size={16} className="animate-spin" />
        写真・文章から日程を読み取っています…
        {progress && <span className="tabular-nums">({progress.done}/{progress.total})</span>}
      </p>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-3 py-4">
        <p className="text-sm text-slate-600">日程を読み取れませんでした。</p>
        {/* 何が起きたか分からないままだと直しようがないので、理由はそのまま出す。 */}
        <p className="break-all text-xs leading-relaxed text-slate-500">{error}</p>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={handleCancel}>
            閉じる
          </Button>
          <Button type="button" className="flex-1" onClick={() => setStatus("input")}>
            やり直す
          </Button>
        </div>
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div className="space-y-4">
        <ScanNotices notices={notices} />
        {rows.length === 0 ? (
          <>
            <EmptyState
              icon={CalendarPlus}
              title="日程になりそうな内容は見つかりませんでした"
              description="日付や時刻が写っている写真、または日付の書かれた文章でお試しください"
            />
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="flex-1" onClick={handleCancel}>
                閉じる
              </Button>
              <Button type="button" className="flex-1" onClick={() => setStatus("input")}>
                やり直す
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="px-1 text-xs leading-relaxed text-slate-500">
              読み取った内容です。日付や時刻が違っていないか確かめてから入れてください。
            </p>
            <div className="space-y-3">
              {rows.map((row, index) => (
                <PlanImportRow
                  key={index}
                  row={row}
                  destination="trip"
                  already={isAlreadyRegistered(row, existingKeys)}
                  outside={isOutsideTrip(trip, row.date)}
                  similar={findSimilarPlan(row, existingSchedule)}
                  missingAmountHint="写真・文章から金額を読み取れませんでした"
                  onChange={(changes) => updateRow(index, changes)}
                />
              ))}
            </div>
            <FormActions>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                キャンセル
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving || savableRows.length === 0}>
                {savableRows.length}件を入れる
              </Button>
            </FormActions>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs leading-relaxed text-slate-500">
        旅行のしおり・チケット・案内のメッセージから、日程をまとめて起こします。写真と文章の
        どちらか一方でも、両方でも構いません。入れる前に一件ずつ確認できます。
      </p>

      <PlanSourceFields
        photos={photos}
        onAddPhotos={addPhotos}
        onRemovePhoto={removePhoto}
        text={text}
        onTextChange={setText}
        textPlaceholder={"例:\n9/12 10:00 羽田発 JAL301\n同日 15:00 ホテルにチェックイン"}
        textHint="旅行会社のしおりや、案内のメッセージをそのまま貼り付けられます。"
      />

      {error && <p className="px-1 text-xs leading-relaxed text-danger">{error}</p>}

      <FormActions>
        <Button type="button" variant="secondary" onClick={handleCancel}>
          キャンセル
        </Button>
        <Button type="button" onClick={handleRead} disabled={!canRead}>
          <Sparkles size={17} />
          読み取る
        </Button>
      </FormActions>
    </div>
  );
}
