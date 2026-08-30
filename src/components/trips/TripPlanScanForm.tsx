import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
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
import {
  MAX_SCAN_IMAGES,
  SUPPORTED_SCAN_MEDIA_TYPES,
  extractTripPlanFromSources,
} from "../../lib/tripPlanScan";
import { prepareImageForScan } from "../../lib/imageDownscale";
import { PlanImportRow } from "../plan/PlanImportRow";
import { Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormActions";
import { EmptyState } from "../ui/EmptyState";

/** 縮める前に弾く大きさ。ここを超える写真は、縮める処理そのものが重くて端末が固まる。 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface PickedPhoto {
  file: File;
  /** 画面に出すためのURL。閉じる時・外す時に revoke する。 */
  url: string;
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("input");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<TripImportRow[]>([]);
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

  function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked: PickedPhoto[] = [];
    for (const file of Array.from(files)) {
      if (photos.length + picked.length >= MAX_SCAN_IMAGES) {
        setError(`写真は一度に${MAX_SCAN_IMAGES}枚までです`);
        break;
      }
      if (!SUPPORTED_SCAN_MEDIA_TYPES.includes(file.type)) {
        setError("対応していない画像形式です。写真(JPEG・PNG・WebP)を選んでください");
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError("写真が大きすぎます。もう少し小さい写真でお試しください");
        continue;
      }
      picked.push({ file, url: URL.createObjectURL(file) });
    }
    if (picked.length > 0) setPhotos((current) => [...current, ...picked]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((_, i) => i !== index);
    });
  }

  function releasePhotos() {
    for (const photo of photos) URL.revokeObjectURL(photo.url);
  }

  const canRead = photos.length > 0 || text.trim().length > 0;

  async function handleRead() {
    if (!canRead) return;
    setStatus("reading");
    setError("");
    try {
      // 送る前に縮める。スマホの写真をそのまま何枚も送ると、読み取りに行く前に
      // サーバーが受け取れる大きさを超える(src/lib/imageDownscale.ts)。
      const images = await Promise.all(photos.map((photo) => prepareImageForScan(photo.file)));
      const items = await extractTripPlanFromSources({
        text,
        images,
        today: todayStr(),
        // 「2日目」のような書き方を実際の日付に直すために、入れ先の旅行の期間を渡す。
        tripStart: trip.startDate,
        tripEnd: trip.endDate,
      });
      // 同じ日に似た予定が既にあるものは、外した状態で並べる。読み取り直すたびに
      // 同じ予定が積み上がるのを、押す前に止めるため。
      setRows(
        toImportRows(items).map((row) =>
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

      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_SCAN_MEDIA_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          addPhotos(e.target.files);
          e.target.value = ""; // 同じ写真を選び直せるようにリセット
        }}
      />

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo, index) => (
            <li key={photo.url} className="relative overflow-hidden rounded-xl border border-white/50">
              <img src={photo.url} alt={`選んだ写真 ${index + 1}枚目`} className="h-24 w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(index)}
                aria-label={`${index + 1}枚目の写真を外す`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-white"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={photos.length >= MAX_SCAN_IMAGES}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={17} />
        {photos.length === 0 ? "写真を選ぶ" : `写真を足す（${photos.length}/${MAX_SCAN_IMAGES}）`}
      </Button>

      <Textarea
        label="文章"
        optional
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"例:\n9/12 10:00 羽田発 JAL301\n同日 15:00 ホテルにチェックイン"}
        hint="旅行会社のしおりや、案内のメッセージをそのまま貼り付けられます。"
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
