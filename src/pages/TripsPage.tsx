import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Plane, Plus } from "lucide-react";
import { db } from "../db/schema";
import type { TripStatus } from "../types";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { EmptyState } from "../components/ui/EmptyState";
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
    <div className="mx-auto max-w-[1280px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.trips}>
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

      <div className="px-5 lg:px-8">
        {showSkeleton ? (
          <ListSkeleton />
        ) : trips.length === 0 ? (
          <EmptyState
            card
            icon={Plane}
            title="旅行がまだ登録されていません"
            description="最初の旅行を追加してみましょう。"
            action={{ label: "旅行を追加する", onClick: () => setCreating(true) }}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {STATUS_GROUPS.map(({ status, label }) => {
              const group = trips.filter((t) => t.status === status);
              if (group.length === 0) return null;
              return (
                <div key={status}>
                  <p className="mb-2 text-sm font-medium text-slate-600">{label}</p>
                  <div className="space-y-3">
                    {group.map((trip) => (
                      <TripCard key={trip.id} trip={trip} onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
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
