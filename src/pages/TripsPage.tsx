import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Plane, Plus } from "lucide-react";
import { db } from "../db/schema";
import type { TripStatus } from "../types";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { Card } from "../components/ui/Card";
import { TripForm } from "../components/trips/TripForm";
import { TripCard } from "../components/trips/TripCard";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";

export async function deleteTripCascade(tripId: string) {
  await Promise.all([
    db.tripSchedule.where("tripId").equals(tripId).delete(),
    db.tripExpenses.where("tripId").equals(tripId).delete(),
    db.tripPackingItems.where("tripId").equals(tripId).delete(),
  ]);
  await db.trips.delete(tripId);
}

const STATUS_GROUPS: { status: TripStatus; label: string }[] = [
  { status: "ongoing", label: "旅行中" },
  { status: "planning", label: "計画中" },
  { status: "completed", label: "完了済み" },
];

export default function TripsPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [creating, setCreating] = useState(false);
  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const trips = tripsResult ?? [];
  const showSkeleton = useDelayedFlag(tripsResult === undefined);

  function handleDelete(id: string) {
    deleteTripCascade(id);
    showToast("削除しました");
  }

  return (
    <div className="spatial-page trips-page micro-contrast mx-auto max-w-[1480px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.trips}>
      <PageHeader
        title="旅行計画"
        backTo="/"
        right={
          <button
            onClick={() => setCreating(true)}
            aria-label="旅行を追加"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors active:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="destination-workspace px-5 lg:px-8">
        {showSkeleton ? (
          <ListSkeleton />
        ) : trips.length === 0 ? (
          <Card className="destination-empty-control p-0">
            <div className="destination-empty-control__visual" aria-hidden="true"><span><Plane size={22} /></span><i /><i /><i /></div>
            <div className="destination-empty-control__copy">
              <span>Destination status</span>
              <div><strong>Trips</strong><b>0</b></div>
              <h2>次の旅を計画しましょう</h2>
              <p>行き先と日程を登録すると、旅程・費用・持ち物をひとつの場所で整理できます。</p>
            </div>
            <div className="destination-empty-control__action">
              <span>Next action</span>
              <button type="button" onClick={() => setCreating(true)}><Plus size={15} />旅行を追加</button>
            </div>
          </Card>
        ) : (
          <div className="destination-grid grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {STATUS_GROUPS.map(({ status, label }) => {
              const group = trips.filter((t) => t.status === status);
              if (group.length === 0) return null;
              return (
                <section key={status} className={`destination-column destination-column--${status}`}>
                  <p className="destination-column__title mb-2 text-sm font-medium text-slate-600">{label}<span>{group.length}</span></p>
                  <div className="space-y-3">
                    {group.map((trip) => (
                      <TripCard key={trip.id} trip={trip} onDelete={handleDelete} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Sheet open={creating} onClose={() => setCreating(false)} title="旅行を追加">
        <TripForm
          onSaved={(id) => {
            setCreating(false);
            navigate(`/trips/${id}`);
          }}
          onCancel={() => setCreating(false)}
        />
      </Sheet>
    </div>
  );
}
