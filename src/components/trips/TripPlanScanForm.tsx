import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, Loader2, Sparkles } from "lucide-react";
import { db } from "../../db/schema";
import { deleteAttachmentsFor } from "../../lib/attachments";
import type { Trip, TripScheduleItem } from "../../types";
import { formatShortDate, todayStr } from "../../lib/date";
import {
  describePlanImportError,
  findSimilarPlan,
  isAlreadyRegistered,
  isOutsideTrip,
  planKey,
  toImportRows,
  toTripExpenseRecord,
  toTripScheduleRecord,
  type ExtractedTripItem,
  type TripImportRow,
} from "../../lib/mailPlanImport";
import {
  describeScanSaved,
  unmentionedSchedule,
  diffAgainstSchedule,
  sameSpot,
  matchRowsToSchedule,
  type ScanRow,
  type ScheduleMatch,
} from "../../lib/tripPlanEdit";
import { scanTripPlan } from "../../lib/tripPlanScan";
import { prepareImageForScan } from "../../lib/imageDownscale";
import { PlanImportRow, type PlanUpdateInfo } from "../plan/PlanImportRow";
import { ScanNotices } from "../plan/ScanNotices";
import { PlanSourceFields, usePickedPhotos } from "../plan/PlanSourceFields";
import { ChatGptInbox } from "./ChatGptInbox";
import { ChatGptPlanGuide } from "./ChatGptPlanGuide";
import { deleteInboxEntry, type InboxEntry } from "../../lib/chatgptInbox";
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
 * すでに入っている日程と同じ予定は、内容が変わっていれば**更新**として出す
 * (出発時刻の変更や、後から分かった場所を、1件ずつ開いて打ち直さずに反映できる)。
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
  const [rows, setRows] = useState<ScanRow[]>([]);
  /** 「文章に無い予定」のうち、消すと選んだ日程の id。 */
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  // 全部は読み取れなかった時の断り。長い文章は日ごとに分けて読むので、その進み具合も持つ。
  const [notices, setNotices] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  // 受信箱から並べた旅程のid。日程に入れたあと、受信箱から消すのに使う。
  const [inboxId, setInboxId] = useState<string>();

  // いま入っている日程。二重に入れないために3通りの見方をする —
  // 日付・時刻・タイトルが揃うものは入れさせず(メールの取り込みと同じ決まり)、
  // 同じ予定で内容が変わっているものは、更新として出す(src/lib/tripPlanEdit.ts)。
  // 同じ日の似たタイトルは、入れられるが既定では外しておく。
  const existingSchedule = useLiveQuery(
    async () => await db.tripSchedule.where("tripId").equals(tripId).toArray(),
    [tripId],
  );
  const existingKeys = existingSchedule
    ? new Set(existingSchedule.map((item) => planKey(item.date, item.startTime, item.title)))
    : undefined;

  // 読み取りは数十秒かかる。終わった時に突き合わせる相手は、「読み取る」を押した時点ではなく
  // その時点のいまの日程にする(押した時の画面の値を握ったままだと、読み込み前に押した時や
  // 読み取り中に同期で日程が増えた時に、入っている予定まで「まだ入っていない」に並ぶ)。
  const existingRef = useRef(existingSchedule);
  existingRef.current = existingSchedule;

  // 更新先を、読み取った後でも引けるように id で持つ。読み取り中に同期で消えた日程は、
  // 見つからないので新しい予定として扱う(存在しない日程を更新しに行かない)。
  const existingById = new Map<string, TripScheduleItem>();
  for (const item of existingSchedule ?? []) if (item.id) existingById.set(item.id, item);

  const canRead = photos.length > 0 || text.trim().length > 0;

  /** 日程の候補(読み取った結果・受信箱の旅程)を、確認画面に並べる。入れるのは確認のあと。 */
  function presentItems(found: ExtractedTripItem[], foundNotices: string[]) {
    setNotices(foundNotices);
    // いまの日程と1対1で突き合わせ、同じ予定で内容が変わっているものは更新として並べる。
    // 確かな一致(題名や時刻が合う)は既定で選び、片方がもう片方を含むだけの一致は
    // 別の予定かもしれないので外しておく。読み取り直すたびに同じ予定が積み上がるのを、
    // 押す前に止めるため。
    const items = toImportRows(found);
    const existing = existingRef.current;
    const matches = matchRowsToSchedule(items, existing);
    // 別の行に使われた日程は、似た予定の断りの相手から外す(使われた日程の「昼食」を理由に、
    // 別の時刻の「昼食」の行まで、重ねて入れる扱いにしない)。
    const unclaimed = unclaimedSchedule(existing, matches.map((match) => match?.item.id));
    setRows(items.map((row, index) => toScanRow(row, matches[index], unclaimed)));
    setDeleteIds([]);
    setStatus("ready");
  }

  /** 受信箱の旅程を確認画面に並べる。受信箱から消すのは、日程に入れたあと(やめた時は残る)。 */
  function handlePickInbox(entry: InboxEntry) {
    setError("");
    setInboxId(entry.id);
    presentItems(entry.items, []);
  }

  /** 読み取り・受信箱の結果から、入力に戻る。受信箱の旅程を入れるつもりでなくなる。 */
  function backToInput() {
    setInboxId(undefined);
    setStatus("input");
  }

  async function handleRead() {
    if (!canRead) return;
    setInboxId(undefined);
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
      presentItems(result.items, result.notices);
    } catch (err) {
      console.error("[tripPlanScan] failed to read a plan:", err);
      setError(describePlanImportError(err));
      setStatus("error");
    }
  }

  function updateRow(index: number, changes: Partial<ScanRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  /** 1行ごとの扱い。更新先が見つかっているか・何が変わるか・入れてよいかを、画面と保存で同じ見方にする。 */
  const unclaimed = unclaimedSchedule(existingSchedule, rows.map((row) => row.matchId));
  const resolved = rows.map((row) => resolveRow(row, existingById, existingKeys, unclaimed));

  /** 実際に入る・更新される行。既に同じ内容が入っているものは、チェックが付いていても入れない。 */
  const savable = resolved.filter((entry) => entry.row.checked && !entry.already && !(entry.updating && entry.changes.length === 0));
  const updateCount = savable.filter((entry) => entry.updating).length;
  const addCount = savable.length - updateCount;
  const expenseCount = savable.filter((entry) => !entry.updating && entry.row.withExpense && entry.row.amount).length;
  // 文章に無い予定。読み取り中に同期で消えたものは数えない。
  const unmentioned = status === "ready" ? unmentionedSchedule(existingSchedule, rows) : [];
  const deleting = deleteIds.filter((id) => unmentioned.some((item) => item.id === id));
  const deleteCount = deleting.length;

  /** いまの日程との違いで、行を3つに分ける(並びは読み取った順のまま)。 */
  const hasExisting = (existingSchedule?.length ?? 0) > 0;
  const groups: Record<DiffGroup, { entry: ResolvedRow; index: number }[]> = { new: [], changed: [], same: [] };
  resolved.forEach((entry, index) => groups[groupOf(entry)].push({ entry, index }));

  function renderRow({ entry, index }: { entry: ResolvedRow; index: number }) {
    return (
      <PlanImportRow
        key={index}
        row={entry.row}
        destination="trip"
        already={entry.already}
        outside={isOutsideTrip(trip, entry.row.date)}
        similar={entry.row.sameAsExisting ? undefined : entry.similar}
        update={
          entry.target
            ? ({
                title: entry.target.title,
                changes: entry.changes,
                on: entry.updating,
                canAdd: !entry.exact,
                onChange: (on) => updateRow(index, { update: on, checked: true }),
              } satisfies PlanUpdateInfo)
            : undefined
        }
        missingAmountHint="写真・文章から金額を読み取れませんでした"
        onChange={(changes) => updateRow(index, changes)}
      />
    );
  }

  async function handleSave() {
    if (savable.length === 0 && deleteCount === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      for (const entry of savable) {
        const { row } = entry;
        if (entry.updating && entry.target) {
          // 更新は、変わる項目だけを書く。文章に無かった項目は、いまの値のまま残す。
          await db.tripSchedule.update(entry.target.id!, diffAgainstSchedule(entry.target, row, { allowRename: row.matchBySlot }).patch);
          continue;
        }
        await db.tripSchedule.add(toTripScheduleRecord(row, tripId, now));
        // 費用は金額が読み取れていて、外されていない分だけ積む(種類がそのまま分類になる)。
        // 更新では積まない(同じ予定の費用が二重になるため)。
        if (row.withExpense && row.amount) await db.tripExpenses.add(toTripExpenseRecord(row, tripId, now));
      }
      for (const id of deleting) {
        await db.tripSchedule.delete(id);
        await deleteAttachmentsFor("tripSchedule", id);
      }
      releasePhotos();
      // 受信箱から入れた旅程は、入れ終わったら受信箱から消す(同じ旅程が残り続けないように)。
      // 消せなくても日程には入っているので、失敗は黙って流す(次に開いた時にまた並ぶだけ)。
      if (inboxId) void deleteInboxEntry(inboxId).catch((err) => console.warn("[chatgptInbox] failed to clear the entry:", err));
      onSaved(describeScanSaved(addCount, updateCount, expenseCount, deleteCount));
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
          <Button type="button" className="flex-1" onClick={backToInput}>
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
              <Button type="button" className="flex-1" onClick={backToInput}>
                やり直す
              </Button>
            </div>
          </>
        ) : (
          <>
            {hasExisting ? (
              <div className="glass-row space-y-1 rounded-xl p-3 text-sm text-slate-700" aria-label="いまの日程との違い">
                <p className="font-medium">いまの日程と比べました</p>
                <p>まだ入っていない予定：{groups.new.length}件</p>
                <p>内容が違う予定：{groups.changed.length}件</p>
                <p className="text-slate-500">入っている予定（同じ内容）：{groups.same.length}件</p>
                {unmentioned.length > 0 && <p className="text-slate-500">文章に無い予定：{unmentioned.length}件</p>}
              </div>
            ) : (
              <p className="px-1 text-xs leading-relaxed text-slate-500">
                読み取った内容です。日付や時刻が違っていないか確かめてから入れてください。
              </p>
            )}
            {hasExisting && groups.new.length === 0 && groups.changed.length === 0 && unmentioned.length === 0 && (
              <p className="px-1 text-sm text-slate-600">足りない予定も、内容が違う予定もありません。いまの日程のままで大丈夫です。</p>
            )}
            {groups.new.length > 0 && (
              <section className="space-y-3" aria-label="まだ入っていない予定">
                {hasExisting && <h3 className="px-1 text-sm font-semibold text-slate-700">まだ入っていない予定（{groups.new.length}件）</h3>}
                {groups.new.map(renderRow)}
              </section>
            )}
            {groups.changed.length > 0 && (
              <section className="space-y-3" aria-label="内容が違う予定">
                <h3 className="px-1 text-sm font-semibold text-slate-700">内容が違う予定（{groups.changed.length}件）</h3>
                <p className="px-1 text-xs text-slate-500">更新を選ぶと、いまの日程がこの内容に変わります。日付や時刻が合っているか確かめてください。</p>
                {groups.changed.map(renderRow)}
              </section>
            )}
            {unmentioned.length > 0 && (
              <section className="space-y-2" aria-label="文章に無い予定">
                <h3 className="px-1 text-sm font-semibold text-slate-700">文章に無い予定（{unmentioned.length}件）</h3>
                <p className="px-1 text-xs text-slate-500">
                  この文章の日にあるのに、文章には無い予定です。計画を組み直して要らなくなったものだけ、選んで消せます(選ばなければ残ります)。
                </p>
                <button
                  type="button"
                  className="px-1 text-xs font-medium text-accent"
                  onClick={() => setDeleteIds(deleteCount === unmentioned.length ? [] : unmentioned.map((item) => item.id!))}
                >
                  {deleteCount === unmentioned.length ? "すべて外す" : "すべて選ぶ"}
                </button>
                <ul className="glass-row space-y-1.5 rounded-xl p-3 text-sm text-slate-700">
                  {unmentioned.map((item) => (
                    <li key={item.id}>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={deleting.includes(item.id!)}
                          onChange={(e) =>
                            setDeleteIds((current) => (e.target.checked ? [...current, item.id!] : current.filter((id) => id !== item.id)))
                          }
                          aria-label={`${item.title}を消す`}
                        />
                        <span>
                          <span className="tabular-nums text-slate-500">
                            {formatShortDate(item.date)} {item.startTime ?? ""}
                            {item.endTime ? `〜${item.endTime}` : ""}
                          </span>{" "}
                          {item.title}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {groups.same.length > 0 && (
              <details className="space-y-3" aria-label="入っている予定">
                <summary className="cursor-pointer px-1 text-sm text-slate-500">入っている予定（同じ内容）{groups.same.length}件を見る</summary>
                <div className="mt-3 space-y-3">{groups.same.map(renderRow)}</div>
              </details>
            )}
            <FormActions>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                キャンセル
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving || (savable.length === 0 && deleteCount === 0)}>
                {saveLabel(addCount, updateCount, deleteCount)}
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
        どちらか一方でも、両方でも構いません。読み取ったら、いまの日程と比べて「まだ入っていない予定」と
        「内容が違う予定」に分けて出します。まだ無いものは追加、違うものは更新できます(文章に無い日程は、
        そのまま残ります)。入れる前に一件ずつ確認できます。
      </p>

      {/* 専用GPTから直接届いた旅程。1件も無ければ何も出ない。 */}
      <ChatGptInbox onPick={handlePickInbox} />

      {/* ChatGPT に旅程を作ってもらい、返事を下の文章の欄へ貼る入り口。読み取りは同じ。 */}
      <ChatGptPlanGuide
        trip={trip}
        // 返事は文章の欄へ足す(すでに打ってある文章を消さない)。
        onPasteReply={(reply) => setText((current) => (current.trim() ? `${current.trim()}\n\n${reply}` : reply))}
      />

      <PlanSourceFields
        photos={photos}
        onAddPhotos={addPhotos}
        onRemovePhoto={removePhoto}
        text={text}
        onTextChange={setText}
        textPlaceholder={"例:\n9/12 10:00 羽田発 JAL301\n同日 15:00 ホテルにチェックイン"}
        textHint="旅行会社のしおりや、案内のメッセージ、ChatGPTの返事をそのまま貼り付けられます。"
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

/** 更新先として他の行に使われていない日程。似た予定かどうかは、これだけを相手に見る。 */
function unclaimedSchedule(existing: TripScheduleItem[] | undefined, claimedIds: (string | undefined)[]): TripScheduleItem[] | undefined {
  if (!existing) return existing;
  const claimed = new Set(claimedIds.filter((id): id is string => !!id));
  return existing.filter((item) => !item.id || !claimed.has(item.id));
}

/** 読み取った1行を、突き合わせの結果から確認画面の行にする。 */
function toScanRow(row: TripImportRow, match: ScheduleMatch | undefined, existing: TripScheduleItem[] | undefined): ScanRow {
  if (match) {
    const { changes } = diffAgainstSchedule(match.item, row, { allowRename: match.bySlot });
    // 内容が変わっている時だけ更新として出す。確かな一致は既定で選び、含むだけの一致は外す。
    if (changes.length > 0) {
      return {
        ...row,
        matchId: match.item.id,
        matchStrength: match.strength,
        matchBySlot: match.bySlot,
        update: true,
        checked: match.strength === "strong",
        withExpense: false,
      };
    }
  }
  // 同じ予定に当たって変わる所も無いものは、入っている予定として外した状態で並べる。
  if (match) return { ...row, update: false, similarTitle: match.item.title, sameAsExisting: true, sameAsId: match.item.id, checked: false, withExpense: false };
  // 当たらなかったが同じ日に似た予定があるものは、これまでどおり外した状態で並べて断りを出す。
  const similarTitle = findSimilarPlan(row, sameArea(row, existing));
  return similarTitle
    ? { ...row, update: false, similarTitle, checked: false, withExpense: false }
    : { ...row, update: false };
}

interface ResolvedRow {
  row: ScanRow;
  /** 突き合わせた既存の日程(更新の候補)。 */
  target?: TripScheduleItem;
  /** 更新するか。更新先があり、更新を選んでいる時だけ。 */
  updating: boolean;
  /** 更新した時に変わる所。 */
  changes: ReturnType<typeof diffAgainstSchedule>["changes"];
  /** 日付・時刻・題名が完全に同じ日程が更新先。追加すると二重になる。 */
  exact: boolean;
  /** 既に同じ内容が入っている(更新するものも無い)。入れさせない。 */
  already: boolean;
  /** 同じ日の似た予定の題名。更新の候補でなく、重ねて入れることになる時の断り。 */
  similar?: string;
}

function resolveRow(
  row: ScanRow,
  existingById: Map<string, TripScheduleItem>,
  existingKeys: Set<string> | undefined,
  existing: TripScheduleItem[] | undefined,
): ResolvedRow {
  const target = row.matchId ? existingById.get(row.matchId) : undefined;
  if (target) {
    const exact = planKey(target.date, target.startTime, target.title) === planKey(row.date, row.startTime, row.title);
    // 完全に同じ日程が更新先なら、追加は選べず、更新だけ。
    const updating = row.update || exact;
    return {
      row,
      target,
      updating,
      changes: diffAgainstSchedule(target, row, { allowRename: row.matchBySlot }).changes,
      exact,
      // 別の予定として追加を選んだ行が、別の既存の日程と完全に同じなら、これも二重になる。
      already: !updating && isAlreadyRegistered(row, existingKeys),
    };
  }
  return {
    row,
    updating: false,
    changes: [],
    exact: false,
    already: isAlreadyRegistered(row, existingKeys),
    similar: row.similarTitle ?? findSimilarPlan(row, sameArea(row, existing)),
  };
}

/** 似た予定を探す相手から、場所が違う日程を外す。場所が違えば、題名が似ていても別の予定なので断りを出さない。 */
function sameArea(row: { location?: string }, existing: TripScheduleItem[] | undefined): TripScheduleItem[] | undefined {
  return existing?.filter((item) => sameSpot(item.location, row.location));
}

/** 確認画面の組。new = まだ入っていない、changed = 同じ予定で内容が違う、same = 同じ内容が入っている。 */
type DiffGroup = "new" | "changed" | "same";

function groupOf(entry: ResolvedRow): DiffGroup {
  if (entry.already || entry.row.sameAsExisting) return "same";
  if (entry.target) return entry.changes.length > 0 ? "changed" : "same";
  return "new";
}

/** 入れる(更新する)ボタンの文言。追加だけの時はこれまでと同じ「N件を入れる」。 */
function saveLabel(added: number, updated: number, deleted = 0): string {
  const base = updated === 0 ? `${added}件を入れる` : added === 0 ? `${updated}件を更新する` : `${added}件を入れて${updated}件を更新する`;
  if (deleted === 0) return base;
  if (added === 0 && updated === 0) return `${deleted}件を消す`;
  // 「…入れる」「…更新する」を続けられる形(「入れ」「更新し」)にしてから足す。
  return `${base.replace(/入れる$/, "入れ").replace(/更新する$/, "更新し")}、${deleted}件を消す`;
}
