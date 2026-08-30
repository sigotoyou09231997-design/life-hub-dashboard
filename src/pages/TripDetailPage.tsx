import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { NotebookPen, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { db } from "../db/schema";
import type { TripScheduleItem, TripExpense, TripPackingItem, TripRoutePlace, TripStatus, DiaryEntry } from "../types";
import { formatDisplayDate, tripDayList, tripDurationLabel, todayStr } from "../lib/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { PageFab } from "../components/ui/PageFab";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { Card } from "../components/ui/Card";
import { TripForm } from "../components/trips/TripForm";
import { TripScheduleForm } from "../components/trips/TripScheduleForm";
import { TripScheduleList } from "../components/trips/TripScheduleList";
import { TripExpenseForm } from "../components/trips/TripExpenseForm";
import { TripExpenseList } from "../components/trips/TripExpenseList";
import { TripPackingForm } from "../components/trips/TripPackingForm";
import { TripPackingList } from "../components/trips/TripPackingList";
import { TripRouteView } from "../components/trips/TripRouteView";
import { TripRouteForm } from "../components/trips/TripRouteForm";
import { TripQuickPlanForm } from "../components/trips/TripQuickPlanForm";
import { TripPlanScanForm } from "../components/trips/TripPlanScanForm";
import { DiaryList } from "../components/diary/DiaryList";
import { DiaryForm } from "../components/diary/DiaryForm";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { deleteTripCascade } from "./TripsPage";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";
import { nextRouteSortOrder, routeKey } from "../lib/mailPlanImport";
import { toRouteSuggestions } from "../lib/tripRouteSuggestions";
import type { RouteSuggestion } from "../lib/tripRouteSuggestions";

type Tab = "schedule" | "expense" | "packing" | "route" | "diary";

const VALID_TABS: Tab[] = ["schedule", "expense", "packing", "route", "diary"];

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
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: Tab = VALID_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "schedule";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editingTrip, setEditingTrip] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<TripScheduleItem | "new" | null>(null);
  /** 「この日に予定を追加」から開いた時の日付。下部の「予定を追加」からは付かない(null)。 */
  const [scheduleDatePreset, setScheduleDatePreset] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<TripExpense | "new" | null>(null);
  const [editingPacking, setEditingPacking] = useState<TripPackingItem | "new" | null>(null);
  const [editingRoute, setEditingRoute] = useState<TripRoutePlace | "new" | null>(null);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | "new" | null>(null);
  /** 日程・費用・ルートをまとめて入れるシートを開いているか。 */
  const [quickPlanOpen, setQuickPlanOpen] = useState(false);
  /** 「＋」で開いたシートの中身。手で打つ(form)か、写真・文章から読み取る(scan)か。 */
  const [quickPlanMode, setQuickPlanMode] = useState<"form" | "scan">("form");
  const [scanOpen, setScanOpen] = useState(false);
  // 日程の場所からルートを起こすとき、追加フォームに渡して埋めておく値。
  const [routePreset, setRoutePreset] = useState<{ name: string; address: string } | undefined>(undefined);

  // Wrapped in an object so `undefined` unambiguously means "still loading" —
  // db.trips.get() itself resolves to `undefined` for a missing id too, which
  // would otherwise be indistinguishable from the query not having run yet.
  const tripResult = useLiveQuery(async () => ({ trip: await db.trips.get(tripId) }), [tripId]);
  const schedule = useLiveQuery(() => db.tripSchedule.where("tripId").equals(tripId).toArray(), [tripId]) ?? [];
  const expenses = useLiveQuery(() => db.tripExpenses.where("tripId").equals(tripId).toArray(), [tripId]) ?? [];
  const packing = useLiveQuery(() => db.tripPackingItems.where("tripId").equals(tripId).toArray(), [tripId]) ?? [];
  const routePlaces =
    useLiveQuery(
      () =>
        db.tripRoutePlaces
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

  const showSkeleton = useDelayedFlag(tripResult === undefined);

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

  async function handleDelete() {
    if (!trip?.id) return;
    if (!confirm(`「${trip.name}」を削除しますか?関連するスケジュール・費用・持ち物・行きたい場所・日記もすべて削除されます。`)) return;
    await deleteTripCascade(trip.id);
    navigate("/trips");
  }

  return (
    <div className="spatial-page trip-detail-page micro-contrast mx-auto max-w-[1480px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.trips}>
      <PageHeader
        title={trip.name}
        subtitle={trip.destination}
        backTo="/trips"
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditingTrip(true)}
              aria-label="旅行を編集"
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Pencil size={18} />
            </button>
            <button
              onClick={handleDelete}
              aria-label="旅行を削除"
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
            >
              <Trash2 size={18} />
            </button>
          </div>
        }
      />

      <section className="trip-detail-hero mx-5 mb-3 lg:mx-8">
        <div className="trip-detail-hero__photo" aria-hidden="true" /><div className="trip-detail-hero__veil" aria-hidden="true" />
        <div className="trip-detail-hero__content"><span>{STATUS_LABEL[trip.status]}</span><h2>{trip.destination}</h2><p>{formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)} · {tripDurationLabel(trip.startDate, trip.endDate)}</p></div>
      </section>

      <div className="spatial-page-tabs mx-5 mb-4 lg:mx-8 lg:mb-5">
        <Tabs
          options={[
            { value: "schedule", label: "日程" },
            { value: "expense", label: "費用" },
            { value: "packing", label: "持ち物" },
            { value: "route", label: "ルート" },
            { value: "diary", label: "日記" },
          ]}
          value={tab}
          onChange={setTab}
          dense
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
          <>
            {/* 旅行のメモ。専用の「概要」タブは行き先も日程もヒーローと重複していて
                消したので、唯一そこにしか無かったメモを日程の先頭に置く。 */}
            {trip.memo && (
              <Card className="trip-memo-note mb-3">
                <p className="text-xs text-slate-400">メモ</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{trip.memo}</p>
              </Card>
            )}
            <TripScheduleList
              dayList={dayList}
              items={schedule}
              onEdit={(item) => setEditingSchedule(item)}
              onDelete={(id) => {
                db.tripSchedule.delete(id);
                showToast("削除しました");
              }}
              onAddForDate={(date) => {
                setScheduleDatePreset(date);
                setEditingSchedule("new");
              }}
              onLocationTap={(location, title) => {
                setTab("route");
                // まだルートに無い場所なら、そのまま追加フォームを開いて拾わせる。
                // 一覧に戻って同じ住所を打ち直させない。
                if (!routePlaces.some((place) => place.address === location || place.name === location)) {
                  setRoutePreset({ name: title, address: location });
                  setEditingRoute("new");
                }
              }}
            />
            {dayList.length > 0 && (
              <div className="mt-4 space-y-2">
                <Button
                  className="w-full"
                  onClick={() => {
                    setScheduleDatePreset(null);
                    setEditingSchedule("new");
                  }}
                >
                  予定を追加
                </Button>
                {/* しおり・チケット・案内のメッセージから日程を起こす入り口。1件ずつ
                    打ち込む「予定を追加」の下に置き、まとめて入れたい時だけ使う。 */}
                <Button variant="secondary" className="w-full" onClick={() => setScanOpen(true)}>
                  <Sparkles size={17} />
                  写真・文章から読み取る
                </Button>
              </div>
            )}
          </>
        )}

        {tab === "expense" && (
          <>
            <TripExpenseList
              budget={trip.budget}
              expenses={expenses}
              onEdit={(expense) => setEditingExpense(expense)}
              onDelete={(id) => {
                db.tripExpenses.delete(id);
                showToast("削除しました");
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
                db.tripPackingItems.delete(id);
                showToast("削除しました");
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
            tripId={tripId}
            destination={trip.destination}
            places={routePlaces}
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
              db.tripRoutePlaces.delete(id);
              showToast("削除しました");
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
                    db.diaryEntries.delete(id);
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
      </div>

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
        title={editingSchedule === "new" ? "予定を追加" : "予定を編集"}
      >
        {editingSchedule && (
          <TripScheduleForm
            tripId={tripId}
            initial={editingSchedule === "new" ? undefined : editingSchedule}
            defaultDate={scheduleDatePreset ?? scheduleDefaultDate}
            onSaved={() => {
              setEditingSchedule(null);
              setScheduleDatePreset(null);
              showToast("保存しました");
            }}
            onCancel={() => {
              setEditingSchedule(null);
              setScheduleDatePreset(null);
            }}
          />
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

      <Sheet open={scanOpen} onClose={() => setScanOpen(false)} title="写真・文章から読み取る">
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
