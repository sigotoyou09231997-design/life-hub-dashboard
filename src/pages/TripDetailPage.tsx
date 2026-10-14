import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, MapPinned, NotebookPen, Pencil, Plus, Replace, Share2, Sparkles, Trash2, Users } from "lucide-react";
import { db } from "../db/schema";
import type {
  TripScheduleItem,
  TripExpense,
  TripPackingItem,
  TripRoutePlace,
  TripStatus,
  TripDocument,
  DiaryEntry,
} from "../types";
import { formatDisplayDate, tripDayList, tripDurationLabel, todayStr } from "../lib/date";
import { deleteAttachmentsFor, groupByOwner } from "../lib/attachments";
import { currenciesByExpenseId } from "../lib/currency";
import { moveItem } from "../lib/noteTypes";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { PageFab } from "../components/ui/PageFab";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TripForm } from "../components/trips/TripForm";
import { TripScheduleForm } from "../components/trips/TripScheduleForm";
import { TripScheduleList } from "../components/trips/TripScheduleList";
import { TripMemoNote } from "../components/trips/TripMemoNote";
import { TripExpenseForm } from "../components/trips/TripExpenseForm";
import { TripExpenseList } from "../components/trips/TripExpenseList";
import { TripPackingForm } from "../components/trips/TripPackingForm";
import { TripPackingList } from "../components/trips/TripPackingList";
import { TripRouteView } from "../components/trips/TripRouteView";
import { TripRouteForm } from "../components/trips/TripRouteForm";
import { TripQuickPlanForm } from "../components/trips/TripQuickPlanForm";
import { TripPlanScanForm } from "../components/trips/TripPlanScanForm";
import { ADD_METHOD_OPTIONS, type AddMethod } from "../components/plan/addMethod";
import { Tabs } from "../components/ui/Tabs";
import { TripDocumentForm } from "../components/trips/TripDocumentForm";
import { TripShareSheet } from "../components/trips/TripShareSheet";
import { TripCollabSheet } from "../components/trips/TripCollabSheet";
import { useIsSharedWithMe } from "../hooks/useTripCollab";
import { TripMyMapsSheet } from "../components/trips/TripMyMapsSheet";
import { TripLocationRemapSheet } from "../components/trips/TripLocationRemapSheet";
import { TripDayRoute } from "../components/trips/TripDayRoute";
import { TripDayPanel } from "../components/trips/TripDayPanel";
import { TripDocumentList } from "../components/trips/TripDocumentList";
import { DiaryList } from "../components/diary/DiaryList";
import { DiaryForm } from "../components/diary/DiaryForm";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/ToastProvider";
import { useConfirm } from "../components/ui/ConfirmProvider";
import { deleteRowWithUndo, quoted } from "../components/ui/undoToast";
import { useWithoutPendingDeletes } from "../hooks/usePendingDeletes";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useTripCover } from "../hooks/useTripCover";
import { useTripWeather } from "../hooks/useTripWeather";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { deleteTripCascade } from "./TripsPage";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";
import { nextRouteSortOrder, routeKey } from "../lib/mailPlanImport";
import { toRouteSuggestions, findRoutePlaceFor } from "../lib/tripRouteSuggestions";
import { mapQueryFor } from "../lib/scheduleDetails";
import type { RouteSuggestion } from "../lib/tripRouteSuggestions";

type Tab = "schedule" | "expense" | "packing" | "route" | "diary" | "documents";

const VALID_TABS: Tab[] = ["schedule", "expense", "packing", "route", "diary", "documents"];

/** 右下の＋(まとめて追加)を出すタブ。 */
const QUICK_PLAN_TABS: Tab[] = ["schedule", "expense", "route"];

const STATUS_LABEL: Record<TripStatus, string> = {
  planning: "計画中",
  ongoing: "旅行中",
  completed: "完了",
};

export default function TripDetailPage() {
  const { id } = useParams();
  const tripId = id ?? "";
  const navigate = useNavigate();
  const showToast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: Tab = VALID_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "schedule";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editingTrip, setEditingTrip] = useState(false);
  /** 共有の設定シートを開いているか(src/components/trips/TripShareSheet.tsx)。 */
  const [sharingTrip, setSharingTrip] = useState(false);
  /** 「一緒に編集」(ほかのアカウントを招く／招かれて参加している)のシートを開いているか(src/components/trips/TripCollabSheet.tsx)。 */
  const [collabOpen, setCollabOpen] = useState(false);
  /** 招かれて参加している旅行か。そうなら、削除と共有リンクは持ち主だけ(参加者は「抜ける」だけ)。 */
  const sharedWithMe = useIsSharedWithMe(tripId);
  /** Googleマイマップ用のCSVを書き出すシートを開いているか(src/components/trips/TripMyMapsSheet.tsx)。 */
  const [myMapsOpen, setMyMapsOpen] = useState(false);
  /** 日程の場所を表でまとめて書き換えるシートを開いているか(src/components/trips/TripLocationRemapSheet.tsx)。 */
  const [remapOpen, setRemapOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<TripScheduleItem | "new" | null>(null);
  /** 「この日に予定を追加」から開いた時の日付。下部の「予定を追加」からは付かない(null)。 */
  const [scheduleDatePreset, setScheduleDatePreset] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<TripExpense | "new" | null>(null);
  const [editingPacking, setEditingPacking] = useState<TripPackingItem | "new" | null>(null);
  const [editingRoute, setEditingRoute] = useState<TripRoutePlace | "new" | null>(null);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | "new" | null>(null);
  const [editingDocument, setEditingDocument] = useState<TripDocument | "new" | null>(null);
  /** 日程・費用・ルートをまとめて入れるシートを開いているか。 */
  const [quickPlanOpen, setQuickPlanOpen] = useState(false);
  /** 「＋」で開いたシートの中身。手で打つ(form)か、写真・文章から読み取る(scan)か。 */
  const [quickPlanMode, setQuickPlanMode] = useState<"form" | "scan">("form");
  const [scanOpen, setScanOpen] = useState(false);
  /** 日程の「予定を追加」の画面の切り替え(入力して追加 / 文章・写真から)。 */
  const [scheduleAddMethod, setScheduleAddMethod] = useState<AddMethod>("form");
  /** 「この予定をコピーして追加」で開いた時の、元の予定の金額・支払った人(src/components/trips/TripScheduleForm.tsx)。 */
  const [copyPrefill, setCopyPrefill] = useState<{ amount: string; paidBy: string } | null>(null);
  /** コピーを重ねても入力画面を作り直すための番号(同じ「コピー」の鍵のままだと、前の中身が残る)。 */
  const [copyCount, setCopyCount] = useState(0);
  useEffect(() => {
    if (editingSchedule === null) {
      setScheduleAddMethod("form");
      setCopyPrefill(null);
    }
  }, [editingSchedule]);
  // 日程の場所からルートを起こすとき、追加フォームに渡して埋めておく値。
  const [routePreset, setRoutePreset] = useState<{ name: string; address: string } | undefined>(undefined);
  /** 日程の場所を押して、ルートで見せたい場所。at は同じ場所をもう一度押した時にも送り直すため。 */
  const [routeFocus, setRouteFocus] = useState<{ id: string; at: number } | null>(null);

  // Wrapped in an object so `undefined` unambiguously means "still loading" —
  // db.trips.get() itself resolves to `undefined` for a missing id too, which
  // would otherwise be indistinguishable from the query not having run yet.
  const tripResult = useLiveQuery(async () => ({ trip: await db.trips.get(tripId) }), [tripId]);
  const schedule = useLiveQuery(() => db.tripSchedule.where("tripId").equals(tripId).toArray(), [tripId]) ?? [];
  // 予定に貼った写真(端末の中だけ。src/lib/attachments.ts)。予定の id ごとにまとめて一覧へ渡す。
  const schedulePhotos = useLiveQuery(() => db.attachments.where("ownerType").equals("tripSchedule").toArray(), []);
  // 費用・持ち物・ルートは、ゴミ箱を押すと確認なしで消え、5秒間「元に戻す」が出る
  // (UI/UX 調査メモ 第4弾 A-2)。その間はまだ DB にあるので、ここで隠す(src/lib/deferredDelete.ts)。
  // 費用の合計・持ち物の件数も同じ一覧から数えるので、一緒に消えて見える。
  const expenses =
    useWithoutPendingDeletes(
      "tripExpenses",
      useLiveQuery(() => db.tripExpenses.where("tripId").equals(tripId).toArray(), [tripId]),
    ) ?? [];
  // 現地通貨で入れた支出の内訳。件数が少ないので全件読んで表にする(src/lib/currency.ts)。
  const expenseCurrencies = useLiveQuery(
    () => db.tripExpenseCurrencies.toArray().then(currenciesByExpenseId),
    [],
  );
  const packing =
    useWithoutPendingDeletes(
      "tripPackingItems",
      useLiveQuery(() => db.tripPackingItems.where("tripId").equals(tripId).toArray(), [tripId]),
    ) ?? [];
  const routePlaces =
    useWithoutPendingDeletes(
      "tripRoutePlaces",
      useLiveQuery(
        () =>
          db.tripRoutePlaces
            .where("tripId")
            .equals(tripId)
            .toArray()
            .then((rows) => rows.sort((a, b) => a.sortOrder - b.sortOrder)),
        [tripId],
      ),
    ) ?? [];

  const documents =
    useLiveQuery(
      () =>
        db.tripDocuments
          .where("tripId")
          .equals(tripId)
          .toArray()
          .then((rows) => rows.sort((a, b) => a.sortOrder - b.sortOrder)),
      [tripId],
    ) ?? [];

  // この旅行の日記。索引は張っていないので、全件から絞る(日記は件数が少ない)。
  const diaryEntries =
    useLiveQuery(
      () =>
        db.diaryEntries
          .toArray()
          .then((rows) =>
            rows
              .filter((entry) => entry.tripId === tripId)
              .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
          ),
      [tripId],
    ) ?? [];

  const dayList = useMemo(
    () => (tripResult?.trip ? tripDayList(tripResult.trip.startDate, tripResult.trip.endDate) : []),
    [tripResult?.trip?.startDate, tripResult?.trip?.endDate],
  );
  const scheduleDefaultDate = dayList.includes(todayStr()) ? todayStr() : (dayList[0] ?? todayStr());
  // 日程タブで見ている日(日にちのチップで切り替える)。最初は、旅行中なら今日、そうでなければ1日目。
  // 旅行の期間を直して、見ていた日が無くなった時も、同じ既定に戻る。
  const [scheduleDay, setScheduleDay] = useState<string>();
  const activeScheduleDay = scheduleDay && dayList.includes(scheduleDay) ? scheduleDay : scheduleDefaultDate;

  // 日程には入っているのに、ルートにはまだ無い場所。ルートのその日が空でも、日程に
  // 予定があるならそこから起こせるようにする(2026-08-27の指摘)。
  const routeSuggestions = useMemo(() => toRouteSuggestions(schedule, routePlaces), [schedule, routePlaces]);

  async function addRouteSuggestions(picked: RouteSuggestion[]) {
    if (picked.length === 0) return;
    const now = Date.now();
    let sortOrder = nextRouteSortOrder(routePlaces);
    const taken = new Set(routePlaces.map((place) => routeKey(place.address)));
    const rows: TripRoutePlace[] = [];
    for (const suggestion of picked) {
      if (taken.has(routeKey(suggestion.address))) continue;
      taken.add(routeKey(suggestion.address));
      rows.push({
        tripId,
        name: suggestion.name,
        address: suggestion.address,
        sortOrder: sortOrder++,
        date: suggestion.date || undefined,
        memo: suggestion.memo,
        visited: false,
        createdAt: now,
      });
    }
    if (rows.length === 0) return;
    await db.tripRoutePlaces.bulkAdd(rows);
    showToast(rows.length > 1 ? `${rows.length}件をルートに入れました` : "ルートに入れました");
  }

  /** 書類の並べ替え。ルートと同じで、入れ替えたあと1始まりの連番に振り直す —
   * 抜けたまま持つと、あとから足した行の位置が決まらなくなる。 */
  async function reorderDocuments(index: number, direction: -1 | 1) {
    const next = moveItem(documents, index, direction);
    if (next === documents) return;
    await Promise.all(
      next.map((document, position) =>
        document.sortOrder === position + 1
          ? Promise.resolve()
          : db.tripDocuments.update(document.id!, { sortOrder: position + 1 }),
      ),
    );
  }

  const showSkeleton = useDelayedFlag(tripResult === undefined);
  // 表紙写真。読み込み中や見つからない場合もフックは同じ回数呼ぶ必要があるので、
  // 下の早期returnより前に置く。
  const cover = useTripCover(tripResult?.trip?.name ?? "", tripResult?.trip?.destination ?? "");
  // 天気も表紙と同じで、読み込み中でもフックの数を変えないよう早期returnより前で呼ぶ。
  const weather = useTripWeather(tripResult?.trip?.destination ?? "");
  // PCだけ、日程の右に「その日の天気・地図・費用」の欄を出す(TripDayPanel)。CSSで隠すだけにしないのは、
  // スマホで見えない地図を読み込ませないためと、経路の選び方を持つ部品(TripDayRoute)を2つ並べないため。
  const isDesktop = useIsDesktop();

  if (!tripId) return null;

  if (tripResult === undefined) {
    return showSkeleton ? (
      <div className="mx-auto max-w-[1280px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.trips}>
        <PageHeader title="旅行" backTo="/trips" />
        <div className="px-5 lg:px-8">
          <ListSkeleton />
        </div>
      </div>
    ) : null;
  }

  if (!tripResult.trip) {
    return (
      <div className="mx-auto max-w-[1280px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.trips}>
        <PageHeader title="旅行" backTo="/trips" />
        <div className="px-5 lg:px-8">
          <Card className="py-10 text-center text-sm text-slate-400">この旅行は見つかりませんでした。</Card>
        </div>
      </div>
    );
  }

  const trip = tripResult.trip;

  /** 予定を消す(編集の中の「この予定を削除」から。確認はフォームが取る)。貼った写真は別のテーブルにあるので一緒に。 */
  function deleteSchedule(id: string) {
    db.tripSchedule.delete(id);
    void deleteAttachmentsFor("tripSchedule", id);
    setEditingSchedule(null);
    setScheduleDatePreset(null);
    showToast("削除しました");
  }

  async function handleDelete() {
    if (!trip?.id || sharedWithMe) return;
    const ok = await confirm({
      title: `「${trip.name}」を削除しますか?`,
      message: "関連するスケジュール・費用・持ち物・行きたい場所・日記もすべて削除されます。",
    });
    if (!ok) return;
    await deleteTripCascade(trip.id);
    navigate("/trips");
  }

  return (
    <div className="spatial-page trip-detail-page micro-contrast mx-auto max-w-[1480px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.trips}>
      {/* 旅行の名前は表紙の写真の上に1回だけ出す。2026-10-12 までは、ページの見出し(旅行の名前)と
          表紙の中(行き先)に2回書いていて、スマホではタブまでに画面の半分近くを使っていた。
          戻る・共有・編集・削除は、見出しの行ごと表紙の上の端へ移した(写真の上でも読めるよう、
          ボタンには暗いすりガラスの丸を敷く。styles/trips.css)。 */}
      <section className="trip-detail-hero mx-5 mb-3 lg:mx-8" aria-labelledby="trip-detail-title">
        <div className="trip-detail-hero__photo" style={{ backgroundImage: `url('${cover.url}')` }} aria-hidden="true" />
        <div className="trip-detail-hero__veil" aria-hidden="true" />
        <div className="trip-detail-hero__bar">
          <Link to="/trips" aria-label="旅行の一覧へ戻る" className="trip-hero-button">
            <ChevronLeft size={21} />
          </Link>
          <div className="trip-detail-hero__actions">
            {/* 一緒に編集(別のアカウントを招く／参加者を見る・抜ける)。ボタンは1つずつ分ける。 */}
            <button type="button" onClick={() => setCollabOpen(true)} aria-label="一緒に編集" className="trip-hero-button">
              <Users size={17} />
            </button>
            {/* しおりの共有リンクと削除は持ち主だけ(招かれて参加している旅行では出さない)。 */}
            {!sharedWithMe && (
              <button type="button" onClick={() => setSharingTrip(true)} aria-label="しおりを共有" className="trip-hero-button">
                <Share2 size={17} />
              </button>
            )}
            <button type="button" onClick={() => setEditingTrip(true)} aria-label="旅行を編集" className="trip-hero-button">
              <Pencil size={17} />
            </button>
            {!sharedWithMe && (
              <button type="button" onClick={handleDelete} aria-label="旅行を削除" className="trip-hero-button trip-hero-button--danger">
                <Trash2 size={17} />
              </button>
            )}
          </div>
        </div>
        <div className="trip-detail-hero__content">
          <span>{STATUS_LABEL[trip.status]}</span>
          <h1 id="trip-detail-title" className="trip-detail-hero__title">
            {trip.name}
          </h1>
          <p>
            {/* 行き先が名前と同じなら繰り返さない(「京都」旅行の行き先「京都」)。 */}
            {trip.destination && trip.destination !== trip.name ? `${trip.destination} · ` : ""}
            {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)} · {tripDurationLabel(trip.startDate, trip.endDate)}
          </p>
        </div>
        {/* Googleの写真を出す時は撮影者のクレジットを併記する決まりになっている。 */}
        {cover.attribution && <span className="trip-detail-hero__credit">写真: {cover.attribution}</span>}
      </section>

      <div className="spatial-page-tabs mx-5 mb-4 lg:mx-8 lg:mb-5">
        <Tabs
          options={[
            { value: "schedule", label: "日程" },
            { value: "expense", label: "費用" },
            { value: "packing", label: "持ち物" },
            { value: "route", label: "ルート" },
            { value: "diary", label: "日記" },
            { value: "documents", label: "書類" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {/* 日程・費用・ルートは同じ1つの出来事を3つの表から見ているだけなので、3回
          打ち直さずに済む入り口を1つ置く。位置は他のページと同じ画面右下
          (src/components/ui/PageFab.tsx)。持ち物・日記はまとめて入れる相手が無いので
          出さない — その2つのタブでは、下の全幅ボタンがそのまま追加の入り口。 */}
      {QUICK_PLAN_TABS.includes(tab) && (
        <PageFab
          onClick={() => {
            // 開き直したら手入力から。前回読み取りで閉じたことを引きずらない。
            setQuickPlanMode("form");
            setQuickPlanOpen(true);
          }}
          label="日程・費用・ルートをまとめて追加"
        >
          <Plus size={24} />
        </PageFab>
      )}

      <div className={`trip-detail-workspace trip-detail-workspace--${tab} px-5 lg:px-8`}>
        {tab === "schedule" && (
          <div className="trip-schedule-layout">
            <div className="trip-schedule-layout__main">
              {/* 旅行のメモ。専用の「概要」タブは行き先も日程もヒーローと重複していて
                  消したので、唯一そこにしか無かったメモを日程の先頭に置く。 */}
              {trip.memo && <TripMemoNote memo={trip.memo} />}
              <TripScheduleList
                photosBySchedule={schedulePhotos ? groupByOwner(schedulePhotos) : undefined}
                expenseBySchedule={new Map(expenses.filter((e) => e.scheduleId).map((e) => [e.scheduleId!, e]))}
                dayList={dayList}
                items={schedule}
                weather={weather}
                selectedDate={activeScheduleDay}
                onSelectDate={setScheduleDay}
                onEdit={(item) => setEditingSchedule(item)}
                onAddForDate={(date) => {
                  setScheduleDay(date);
                  setScheduleDatePreset(date);
                  setEditingSchedule("new");
                }}
                onReorder={(changes) => {
                  void Promise.all(changes.map((change) => db.tripSchedule.update(change.id, { sortOrder: change.sortOrder })));
                }}
                onLocationTap={(location, title, date) => {
                  setTab("route");
                  // ルートにある場所なら、その日に切り替えて、その場所まで送る(2026-10-11、「ルートの該当の
                  // 部分に飛んで欲しいのに、違うところに飛んでる」— タブを替えるだけで、開いていた日の先頭が出ていた)。
                  // 日程に住所が入っていれば、ルートの場所は住所で作られている(mapQueryFor)。住所でも探す。
                  const tapped = schedule.find((entry) => entry.date === date && entry.location?.trim() === location.trim());
                  const mapQuery = tapped ? mapQueryFor(tapped) : undefined;
                  const place = findRoutePlaceFor(routePlaces, location, date, mapQuery);
                  if (place?.id) {
                    setRouteFocus({ id: place.id, at: Date.now() });
                    return;
                  }
                  // まだルートに無い場所なら、そのまま追加フォームを開いて拾わせる。
                  // 一覧に戻って同じ住所を打ち直させない。
                  setRoutePreset({ name: title, address: mapQuery ?? location });
                  setEditingRoute("new");
                }}
              />
              {dayList.length > 0 && (
                <div className="mt-4 space-y-2">
                  {/* 見ている日の日程を、Googleマップの経路として開く。PCでは右の欄に地図そのものが出ているので出さない。 */}
                  {!isDesktop && <TripDayRoute items={schedule} date={activeScheduleDay} />}
                  <Button
                    className="w-full"
                    onClick={() => {
                      // 見ている日に足すのが自然(3日目を見ながら足すのに、日付を1日目から直させない)。
                      setScheduleDatePreset(activeScheduleDay);
                      setEditingSchedule("new");
                    }}
                  >
                    予定を追加
                  </Button>
                  {/* しおり・チケット・案内のメッセージから日程を起こす入り口。1件ずつ
                      打ち込む「予定を追加」の下に置き、まとめて入れたい時だけ使う。 */}
                  <Button variant="secondary" className="w-full" onClick={() => setScanOpen(true)}>
                    <Sparkles size={17} />
                    写真・文章から追加・更新
                  </Button>
                  {/* 日程をGoogleマイマップへ入れるためのCSV。マイマップには外から書き込めないので、
                      ファイルを渡して取り込んでもらう形(TripMyMapsSheet)。 */}
                  <Button variant="secondary" className="w-full" onClick={() => setMyMapsOpen(true)}>
                    <MapPinned size={17} />
                    Googleマイマップに入れる
                  </Button>
                  {/* 「霊山寺」のような名前だけの場所を、都道府県・市区町村つきに表でまとめて直す。
                      地図(マイマップ・ルート)が別の場所を選ぶのを避けるため。 */}
                  <Button variant="secondary" className="w-full" onClick={() => setRemapOpen(true)}>
                    <Replace size={17} />
                    場所をまとめて直す
                  </Button>
                </div>
              )}
            </div>
            {isDesktop && dayList.length > 0 && (
              <TripDayPanel
                date={activeScheduleDay}
                dayNumber={dayList.indexOf(activeScheduleDay) + 1}
                schedule={schedule}
                weather={weather}
                expenses={expenses}
                budget={trip.budget}
                onEditExpense={(expense) => setEditingExpense(expense)}
                onShowExpenses={() => setTab("expense")}
              />
            )}
          </div>
        )}

        {tab === "expense" && (
          <>
            <TripExpenseList
              budget={trip.budget}
              members={trip.members}
              expenses={expenses}
              currencies={expenseCurrencies}
              onEdit={(expense) => setEditingExpense(expense)}
              onDelete={(id) => {
                // 確認なしで隠し、お知らせが閉じた時に本当に消す(UI/UX 調査メモ 第4弾 A-2)。
                // 現地通貨の内訳もその時に一緒に落とす(src/lib/undoableDeletes.ts)。
                deleteRowWithUndo(
                  "tripExpense",
                  id,
                  `${quoted(expenses.find((e) => e.id === id)?.title) || "費用"}を削除しました`,
                );
              }}
            />
            <Button className="mt-4 w-full" onClick={() => setEditingExpense("new")}>
              費用を追加
            </Button>
          </>
        )}

        {tab === "packing" && (
          <>
            <TripPackingList
              items={packing}
              onEdit={(item) => setEditingPacking(item)}
              onDelete={(id) => {
                // 確認なしで隠し、お知らせが閉じた時に本当に消す(UI/UX 調査メモ 第4弾 A-2)。
                deleteRowWithUndo(
                  "tripPackingItem",
                  id,
                  `${quoted(packing.find((p) => p.id === id)?.title) || "持ち物"}を削除しました`,
                );
              }}
            />
            <Button className="mt-4 w-full" onClick={() => setEditingPacking("new")}>
              持ち物を追加
            </Button>
          </>
        )}

        {tab === "route" && (
          <TripRouteView
            dayList={dayList}
            schedule={schedule}
            tripId={tripId}
            destination={trip.destination}
            places={routePlaces}
            focus={routeFocus}
            suggestions={routeSuggestions}
            onAddSuggestions={addRouteSuggestions}
            onAdd={() => {
              setRoutePreset(undefined);
              setEditingRoute("new");
            }}
            onFirstSaved={() => showToast("保存しました")}
            onEdit={(place) => {
              setRoutePreset(undefined);
              setEditingRoute(place);
            }}
            onDelete={(id) => {
              // 確認なしで隠し、お知らせが閉じた時に本当に消す(UI/UX 調査メモ 第4弾 A-2)。
              deleteRowWithUndo(
                "tripRoutePlace",
                id,
                `${quoted(routePlaces.find((p) => p.id === id)?.name) || "場所"}をルートから削除しました`,
              );
            }}
          />
        )}

        {tab === "diary" && (
          <>
            {diaryEntries.length === 0 ? (
              <EmptyState
                card
                icon={NotebookPen}
                title="この旅行の日記はまだありません"
                description="書き始めると、そのときいた場所も一緒に残せます。"
                action={{ label: "日記を書く", onClick: () => setEditingDiary("new") }}
              />
            ) : (
              <>
                <DiaryList
                  entries={diaryEntries}
                  onEdit={(entry) => setEditingDiary(entry)}
                  onDelete={(id) => {
                    // 貼った写真は別のテーブルにあるので、一緒に落とす
                    // (src/lib/attachments.ts)。
                    void Promise.all([db.diaryEntries.delete(id), deleteAttachmentsFor("diary", id)]);
                    showToast("削除しました");
                  }}
                />
                <Button className="mt-4 w-full" onClick={() => setEditingDiary("new")}>
                  日記を書く
                </Button>
              </>
            )}
          </>
        )}

        {tab === "documents" && (
          <>
            <TripDocumentList
              documents={documents}
              onEdit={(document) => setEditingDocument(document)}
              onDelete={async (document) => {
                if (!document.id) return;
                const ok = await confirm({
                  title: `「${document.title}」を削除しますか?`,
                  message: "貼った写真も一緒に消えます。",
                });
                if (!ok) return;
                // 貼った写真は別のテーブルにあるので、一緒に落とす(src/lib/attachments.ts)。
                void Promise.all([
                  db.tripDocuments.delete(document.id),
                  deleteAttachmentsFor("tripDocument", document.id),
                ]);
                showToast("削除しました");
              }}
              onReorder={(index, direction) => void reorderDocuments(index, direction)}
            />
            <Button className="mt-4 w-full" onClick={() => setEditingDocument("new")}>
              書類を追加
            </Button>
          </>
        )}
      </div>

      <Sheet
        open={editingDocument !== null}
        onClose={() => setEditingDocument(null)}
        title={editingDocument === "new" ? "書類を追加" : "書類を編集"}
      >
        {editingDocument && (
          <TripDocumentForm
            tripId={tripId}
            initial={editingDocument === "new" ? undefined : editingDocument}
            count={documents.length}
            onSaved={() => {
              setEditingDocument(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingDocument(null)}
          />
        )}
      </Sheet>

      <Sheet open={sharingTrip} onClose={() => setSharingTrip(false)} title="しおりを共有">
        {sharingTrip && <TripShareSheet tripId={tripId} tripName={trip.name} onClose={() => setSharingTrip(false)} />}
      </Sheet>

      <Sheet open={collabOpen} onClose={() => setCollabOpen(false)} title="一緒に編集">
        {collabOpen && (
          <TripCollabSheet
            tripId={tripId}
            tripName={trip.name}
            role={sharedWithMe ? "member" : "owner"}
            onClose={() => setCollabOpen(false)}
            onLeft={() => navigate("/trips")}
          />
        )}
      </Sheet>

      <Sheet open={myMapsOpen} onClose={() => setMyMapsOpen(false)} title="Googleマイマップに入れる">
        {myMapsOpen && <TripMyMapsSheet trip={trip} schedule={schedule} onClose={() => setMyMapsOpen(false)} />}
      </Sheet>

      <Sheet open={remapOpen} onClose={() => setRemapOpen(false)} title="場所をまとめて直す">
        {remapOpen && (
          <TripLocationRemapSheet
            tripName={trip?.name}
            destination={trip?.destination}
            schedule={schedule}
            routePlaces={routePlaces}
            onClose={() => setRemapOpen(false)}
          />
        )}
      </Sheet>

      <Sheet open={editingTrip} onClose={() => setEditingTrip(false)} title="旅行を編集">
        <TripForm
          initial={trip}
          onSaved={() => {
            setEditingTrip(false);
            showToast("保存しました");
          }}
          onCancel={() => setEditingTrip(false)}
        />
      </Sheet>

      <Sheet
        open={editingSchedule !== null}
        onClose={() => {
          setEditingSchedule(null);
          setScheduleDatePreset(null);
        }}
        title={editingSchedule === "new" ? "予定を追加" : editingSchedule?.id ? "予定を編集" : "予定をコピーして追加"}
      >
        {editingSchedule === "new" && (
          <Tabs className="mb-4" options={ADD_METHOD_OPTIONS} value={scheduleAddMethod} onChange={setScheduleAddMethod} />
        )}
        {editingSchedule === "new" && scheduleAddMethod === "scan" ? (
          <TripPlanScanForm
            tripId={tripId}
            trip={trip}
            onSaved={(message) => {
              setEditingSchedule(null);
              setScheduleDatePreset(null);
              showToast(message);
            }}
            onCancel={() => {
              setEditingSchedule(null);
              setScheduleDatePreset(null);
            }}
          />
        ) : (
          editingSchedule && (
            <TripScheduleForm
              key={editingSchedule === "new" ? "new" : (editingSchedule.id ?? `copy-${copyCount}`)}
              tripId={tripId}
              members={trip.members}
              initial={editingSchedule === "new" ? undefined : editingSchedule}
              prefill={editingSchedule !== "new" && !editingSchedule.id ? (copyPrefill ?? undefined) : undefined}
              onCopy={(draft) => {
                // 元の予定の費用(金額・支払った人)も写す。コピーは新しい予定なので、費用も新しく作られる。
                setCopyPrefill({ amount: draft.amount, paidBy: draft.paidBy });
                setCopyCount((count) => count + 1);
                setEditingSchedule(draft.item);
              }}
              defaultDate={scheduleDatePreset ?? scheduleDefaultDate}
              onDelete={editingSchedule !== "new" && editingSchedule.id ? () => deleteSchedule(editingSchedule.id!) : undefined}
              onSaved={(date, routeNote) => {
                setEditingSchedule(null);
                setScheduleDatePreset(null);
                // 別の日に保存した予定が、消えたように見えないよう、その日へ切り替える。
                if (dayList.includes(date)) setScheduleDay(date);
                // 日程に合わせてルートの場所も直した時は、そう伝える(黙って書き換えない)。
                showToast(routeNote ? `保存しました。${routeNote}` : "保存しました");
              }}
              onCancel={() => {
                setEditingSchedule(null);
                setScheduleDatePreset(null);
              }}
            />
          )
        )}
      </Sheet>

      <Sheet
        open={editingExpense !== null}
        onClose={() => setEditingExpense(null)}
        title={editingExpense === "new" ? "費用を追加" : "費用を編集"}
      >
        {editingExpense && (
          <TripExpenseForm
            tripId={tripId}
            members={trip.members}
            initial={editingExpense === "new" ? undefined : editingExpense}
            onSaved={() => {
              setEditingExpense(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingExpense(null)}
          />
        )}
      </Sheet>

      <Sheet
        open={editingDiary !== null}
        onClose={() => setEditingDiary(null)}
        title={editingDiary === "new" ? "日記を書く" : "日記を編集"}
      >
        {editingDiary && (
          <DiaryForm
            initial={editingDiary === "new" ? undefined : editingDiary}
            tripId={tripId}
            defaultDate={scheduleDefaultDate}
            onSaved={() => {
              setEditingDiary(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingDiary(null)}
          />
        )}
      </Sheet>

      <Sheet
        open={editingRoute !== null}
        onClose={() => setEditingRoute(null)}
        title={editingRoute === "new" ? "行きたい場所を追加" : "行きたい場所を編集"}
      >
        {editingRoute && (
          <TripRouteForm
            tripId={tripId}
            initial={editingRoute === "new" ? undefined : editingRoute}
            nextSortOrder={(routePlaces[routePlaces.length - 1]?.sortOrder ?? 0) + 1}
            dayList={dayList}
            preset={editingRoute === "new" ? routePreset : undefined}
            onSaved={() => {
              setEditingRoute(null);
              setRoutePreset(undefined);
              showToast("保存しました");
            }}
            onCancel={() => {
              setEditingRoute(null);
              setRoutePreset(undefined);
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={quickPlanOpen}
        onClose={() => setQuickPlanOpen(false)}
        title={quickPlanMode === "scan" ? "写真・文章から読み取る" : "まとめて追加"}
      >
        {quickPlanOpen && quickPlanMode === "form" && (
          <div className="space-y-3">
            {/* 手で打つ前に、しおり・チケットがあるならそのまま読ませられる入り口。
                「＋」から1回押すだけで着けるよう、フォームの上に置く。 */}
            <Button variant="secondary" className="w-full" onClick={() => setQuickPlanMode("scan")}>
              <Sparkles size={17} />
              写真・文章から読み取る
            </Button>
            <TripQuickPlanForm
              tripId={tripId}
              defaultDate={scheduleDefaultDate}
              nextSortOrder={nextRouteSortOrder(routePlaces)}
              existingRouteKeys={new Set(routePlaces.map((place) => routeKey(place.address)))}
              onSaved={(message) => {
                setQuickPlanOpen(false);
                showToast(message);
              }}
              onCancel={() => setQuickPlanOpen(false)}
            />
          </div>
        )}
        {quickPlanOpen && quickPlanMode === "scan" && (
          <TripPlanScanForm
            tripId={tripId}
            trip={trip}
            onSaved={(message) => {
              setQuickPlanOpen(false);
              showToast(message);
            }}
            // 押し間違えても戻れるように、ここのキャンセルは手入力に戻す(閉じない)。
            onCancel={() => setQuickPlanMode("form")}
          />
        )}
      </Sheet>

      <Sheet open={scanOpen} onClose={() => setScanOpen(false)} title="写真・文章から追加・更新">
        {scanOpen && (
          <TripPlanScanForm
            tripId={tripId}
            trip={trip}
            onSaved={(message) => {
              setScanOpen(false);
              showToast(message);
            }}
            onCancel={() => setScanOpen(false)}
          />
        )}
      </Sheet>

      <Sheet
        open={editingPacking !== null}
        onClose={() => setEditingPacking(null)}
        title={editingPacking === "new" ? "持ち物を追加" : "持ち物を編集"}
      >
        {editingPacking && (
          <TripPackingForm
            tripId={tripId}
            initial={editingPacking === "new" ? undefined : editingPacking}
            onSaved={() => {
              setEditingPacking(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingPacking(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
