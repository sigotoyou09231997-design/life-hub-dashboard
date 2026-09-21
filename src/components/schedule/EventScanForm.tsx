import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, Loader2, Sparkles } from "lucide-react";
import { db } from "../../db/schema";
import { todayStr } from "../../lib/date";
import {
  describePlanImportError,
  findSimilarPlan,
  isAlreadyRegistered,
  planKey,
  toCalendarEventRecord,
  toImportRows,
  type TripImportRow,
} from "../../lib/mailPlanImport";
import { extractTripPlanFromSources } from "../../lib/tripPlanScan";
import { prepareImageForScan } from "../../lib/imageDownscale";
import { PlanImportRow } from "../plan/PlanImportRow";
import { PlanSourceFields, usePickedPhotos } from "../plan/PlanSourceFields";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormActions";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  /** 入れ終わった時。知らせの文言と、入れた予定のうちいちばん早い日付を渡す
   * (カレンダーをその日へ動かして、入った予定をすぐ見られるようにするため)。 */
  onSaved: (message: string, firstDate: string) => void;
  onCancel: () => void;
}

type Status = "input" | "reading" | "ready" | "error";

/**
 * 案内の文章・チラシ・予約画面のスクショ・手書きのメモなどから、予定をまとめて起こす。
 *
 * 読み取りは旅行の日程(TripPlanScanForm)・Gmailの取り込みと同じサーバー関数
 * (netlify/functions/extractTripPlan.ts)。あちらの指示はもともと面接・受診・締切など
 * 旅行以外の予定も拾うように書いてあるので、予定用に別の関数は作らない — 同じ判断を
 * 2か所に分けると片方だけ良くなってしまうため。
 *
 * 読み取った結果はそのまま保存せず、必ずここで確認・修正してから入れる。日付や時刻の
 * 読み違いがそのまま入ると、当日それを信じて動いてしまうため。
 */
export function EventScanForm({ onSaved, onCancel }: Props) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("input");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<TripImportRow[]>([]);
  const [saving, setSaving] = useState(false);
  const { photos, addPhotos, removePhoto, releasePhotos } = usePickedPhotos(setError);

  // 日付・時刻・タイトルが揃う予定は入れさせず、同じ日の似たタイトルは既定で外しておく
  // (旅行の日程・メールの取り込みと同じ決まり)。
  const existingEvents = useLiveQuery(() => db.calendarEvents.toArray(), []);
  const existingKeys = existingEvents
    ? new Set(existingEvents.map((event) => planKey(event.date, event.startTime, event.title)))
    : undefined;

  const canRead = photos.length > 0 || text.trim().length > 0;

  async function handleRead() {
    if (!canRead) return;
    setStatus("reading");
    setError("");
    try {
      // 送る前に縮める。スマホの写真をそのまま何枚も送ると、サーバーが受け取れる大きさを超える。
      const images = await Promise.all(photos.map((photo) => prepareImageForScan(photo.file)));
      const items = await extractTripPlanFromSources({ text, images, today: todayStr() });
      setRows(
        toImportRows(items).map((row) =>
          findSimilarPlan(row, existingEvents) ? { ...row, checked: false, withExpense: false } : row,
        ),
      );
      setStatus("ready");
    } catch (err) {
      console.error("[eventScan] failed to read events:", err);
      setError(describePlanImportError(err));
      setStatus("error");
    }
  }

  function updateRow(index: number, changes: Partial<TripImportRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  /** 実際に入る行。既に同じ内容が入っているものは、チェックが付いていても入れない。 */
  const savableRows = rows.filter((row) => row.checked && !isAlreadyRegistered(row, existingKeys));

  async function handleSave() {
    if (savableRows.length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      for (const row of savableRows) {
        await db.calendarEvents.add(toCalendarEventRecord(row, now));
      }
      releasePhotos();
      const firstDate = savableRows.map((row) => row.date).sort()[0];
      onSaved(`予定に${savableRows.length}件入れました`, firstDate);
    } catch (err) {
      console.error("[eventScan] failed to save:", err);
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
        写真・文章から予定を読み取っています…
      </p>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-3 py-4">
        <p className="text-sm text-slate-600">予定を読み取れませんでした。</p>
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
              title="予定になりそうな内容は見つかりませんでした"
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
                  destination="event"
                  already={isAlreadyRegistered(row, existingKeys)}
                  outside={false}
                  similar={findSimilarPlan(row, existingEvents)}
                  missingAmountHint=""
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
        案内のメッセージ・チラシ・予約画面のスクショ・手書きのメモなどから、予定をまとめて起こします。
        写真と文章のどちらか一方でも、両方でも構いません。入れる前に一件ずつ確認できます。
      </p>

      <PlanSourceFields
        photos={photos}
        onAddPhotos={addPhotos}
        onRemovePhoto={removePhoto}
        text={text}
        onTextChange={setText}
        textPlaceholder={"例:\n9/30(火) 15:00 歯医者\n10/4 18:30〜 渋谷で飲み会"}
        textHint="LINEやメールの案内を、そのまま貼り付けられます。"
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
