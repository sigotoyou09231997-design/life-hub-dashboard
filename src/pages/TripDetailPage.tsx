import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, Trash2 } from "lucide-react";
import { db } from "../db/schema";
import type { TripScheduleItem, TripExpense, TripPackingItem, TripStatus } from "../types";
import { formatDisplayDate, tripDayList, tripDurationLabel, todayStr } from "../lib/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { TripForm } from "../components/trips/TripForm";
import { TripScheduleForm } from "../components/trips/TripScheduleForm";
import { TripScheduleList } from "../components/trips/TripScheduleList";
import { TripExpenseForm } from "../components/trips/TripExpenseForm";
import { TripExpenseList } from "../components/trips/TripExpenseList";
import { TripPackingForm } from "../components/trips/TripPackingForm";
import { TripPackingList } from "../components/trips/TripPackingList";
import { TripMapView } from "../components/trips/TripMapView";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { deleteTripCascade } from "./TripsPage";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";

type Tab = "overview" | "schedule" | "expense" | "packing" | "map";

const VALID_TABS: Tab[] = ["overview", "schedule", "expense", "packing", "map"];

const STATUS_LABEL: Record<TripStatus, string> = {
  planning: "計画中",
  ongoing: "旅行中",
  completed: "完了",
};

const STATUS_TONE: Record<TripStatus, "accent" | "success" | "neutral"> = {
  planning: "neutral",
  ongoing: "accent",
  completed: "success",
};

export default function TripDetailPage() {
  const { id } = useParams();
  const tripId = Number(id);
  const navigate = useNavigate();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: Tab = VALID_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editingTrip, setEditingTrip] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<TripScheduleItem | "new" | null>(null);
  const [editingExpense, setEditingExpense] = useState<TripExpense | "new" | null>(null);
  const [editingPacking, setEditingPacking] = useState<TripPackingItem | "new" | null>(null);
  const [mapQuery, setMapQuery] = useState("");

  // Wrapped in an object so `undefined` unambiguously means "still loading" —
  // db.trips.get() itself resolves to `undefined` for a missing id too, which
  // would otherwise be indistinguishable from the query not having run yet.
  const tripResult = useLiveQuery(async () => ({ trip: await db.trips.get(tripId) }), [tripId]);
  const schedule = useLiveQuery(() => db.tripSchedule.where("tripId").equals(tripId).toArray(), [tripId]) ?? [];
  const expenses = useLiveQuery(() => db.tripExpenses.where("tripId").equals(tripId).toArray(), [tripId]) ?? [];
  const packing = useLiveQuery(() => db.tripPackingItems.where("tripId").equals(tripId).toArray(), [tripId]) ?? [];

  const dayList = useMemo(
    () => (tripResult?.trip ? tripDayList(tripResult.trip.startDate, tripResult.trip.endDate) : []),
    [tripResult?.trip?.startDate, tripResult?.trip?.endDate],
  );
  const scheduleDefaultDate = dayList.includes(todayStr()) ? todayStr() : (dayList[0] ?? todayStr());

  const scheduleLocations = useMemo(
    () => Array.from(new Set(schedule.map((s) => s.location).filter((l): l is string => !!l))),
    [schedule],
  );

  const showSkeleton = useDelayedFlag(tripResult === undefined);

  if (Number.isNaN(tripId)) return null;

  if (tripResult === undefined) {
    return showSkeleton ? (
      <div className="pb-10" style={AREA_ACCENT_STYLE.trips}>
        <PageHeader title="旅行" backTo="/trips" />
        <div className="px-5">
          <ListSkeleton />
        </div>
      </div>
    ) : null;
  }

  if (!tripResult.trip) {
    return (
      <div className="pb-10" style={AREA_ACCENT_STYLE.trips}>
        <PageHeader title="旅行" backTo="/trips" />
        <div className="px-5">
          <Card className="py-10 text-center text-sm text-slate-400">この旅行は見つかりませんでした。</Card>
        </div>
      </div>
    );
  }

  const trip = tripResult.trip;

  async function handleDelete() {
    if (!trip?.id) return;
    if (!confirm(`「${trip.name}」を削除しますか?関連するスケジュール・費用・持ち物もすべて削除されます。`)) return;
    await deleteTripCascade(trip.id);
    navigate("/trips");
  }

  return (
    <div className="pb-10" style={AREA_ACCENT_STYLE.trips}>
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

      <div className="mx-5 mb-4">
        <Tabs
          options={[
            { value: "overview", label: "概要" },
            { value: "schedule", label: "日程" },
            { value: "expense", label: "費用" },
            { value: "packing", label: "持ち物" },
            { value: "map", label: "地図" },
          ]}
          value={tab}
          onChange={setTab}
          dense
        />
      </div>

      <div className="px-5">
        {tab === "overview" && (
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[trip.status]}>{STATUS_LABEL[trip.status]}</Badge>
              <span className="text-sm text-slate-400">{tripDurationLabel(trip.startDate, trip.endDate)}</span>
            </div>
            <div>
              <p className="text-xs text-slate-400">日程</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">
                {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">行き先</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">{trip.destination}</p>
            </div>
            {trip.budget != null && (
              <div>
                <p className="text-xs text-slate-400">予算</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">¥{trip.budget.toLocaleString()}</p>
              </div>
            )}
            {trip.memo && (
              <div>
                <p className="text-xs text-slate-400">メモ</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{trip.memo}</p>
              </div>
            )}
          </Card>
        )}

        {tab === "schedule" && (
          <>
            <TripScheduleList
              dayList={dayList}
              items={schedule}
              onEdit={(item) => setEditingSchedule(item)}
              onDelete={(id) => {
                db.tripSchedule.delete(id);
                showToast("削除しました");
              }}
              onLocationTap={(location) => {
                setMapQuery(location);
                setTab("map");
              }}
            />
            {dayList.length > 0 && (
              <Button className="mt-4 w-full" onClick={() => setEditingSchedule("new")}>
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

        {tab === "map" && (
          <TripMapView
            destination={trip.destination}
            locations={scheduleLocations}
            selectedQuery={mapQuery}
            onSelectQuery={setMapQuery}
          />
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
        onClose={() => setEditingSchedule(null)}
        title={editingSchedule === "new" ? "予定を追加" : "予定を編集"}
      >
        {editingSchedule && (
          <TripScheduleForm
            tripId={tripId}
            initial={editingSchedule === "new" ? undefined : editingSchedule}
            defaultDate={scheduleDefaultDate}
            onSaved={() => {
              setEditingSchedule(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingSchedule(null)}
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
