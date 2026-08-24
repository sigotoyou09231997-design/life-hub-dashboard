import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { db } from "../db/schema";
import type { TripScheduleItem, TripExpense, TripPackingItem, TripRoutePlace, TripStatus, DiaryEntry } from "../types";
import { formatDisplayDate, tripDayList, tripDurationLabel, todayStr } from "../lib/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
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
import { DiaryList } from "../components/diary/DiaryList";
import { DiaryForm } from "../components/diary/DiaryForm";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { deleteTripCascade } from "./TripsPage";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";

type Tab = "schedule" | "expense" | "packing" | "route" | "diary";

const VALID_TABS: Tab[] = ["schedule", "expense", "packing", "route", "diary"];

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
              <Button
                className="mt-4 w-full"
                onClick={() => {
                  setScheduleDatePreset(null);
                  setEditingSchedule("new");
                }}
              >
                予定を追加
              </Button>
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
            tripId={tripId}
            destination={trip.destination}
            places={routePlaces}
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
