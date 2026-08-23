import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Plane, Plus } from "lucide-react";
import { db } from "../db/schema";
import type { Trip } from "../types";
import { todayStr } from "../lib/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { Card } from "../components/ui/Card";
import { TripForm } from "../components/trips/TripForm";
import { TripLeadCard } from "../components/trips/TripLeadCard";
import { TripPlanCard } from "../components/trips/TripPlanCard";
import { TripArchiveList } from "../components/trips/TripArchiveList";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";

export async function deleteTripCascade(tripId: string) {
  await Promise.all([
    db.tripSchedule.where("tripId").equals(tripId).delete(),
    db.tripExpenses.where("tripId").equals(tripId).delete(),
    db.tripPackingItems.where("tripId").equals(tripId).delete(),
    db.tripRoutePlaces.where("tripId").equals(tripId).delete(),
  ]);
  await db.trips.delete(tripId);
}

/**
 * 一覧の並び。以前は「旅行中 / 計画中 / 完了済み」を同じ幅の3列に流していたが、
 * 3列に割るとカードが小さくなって写真が主役になれず、旅行中が1件しか無いと
 * その列だけが空のまま伸びていた。代わりに1件だけを大きく先頭に立てる:
 *
 *   lead     いま行っている旅行。無ければ、次に出発する旅行。
 *   upcoming これから行く残り。近い順。
 *   archive  終わった旅行。新しい順。
 *
 * 終わった旅行しか無いときは archive を先頭に置いても寂しいだけなので、その
 * ときだけ最後の1件を lead に立てて画面が空で始まらないようにする。
 */
function splitTrips(trips: Trip[], today: string) {
  const byStart = (a: Trip, b: Trip) => a.startDate.localeCompare(b.startDate);

  const ongoing = trips.filter((trip) => trip.status === "ongoing").sort(byStart);
  const planning = trips.filter((trip) => trip.status === "planning").sort(byStart);
  const completed = trips.filter((trip) => trip.status === "completed").sort((a, b) => b.endDate.localeCompare(a.endDate));

  // 出発済みのものより、これから出発するものを先に出す。
  const upcomingFirst = [...planning].sort(
    (a, b) => Number(a.startDate < today) - Number(b.startDate < today) || byStart(a, b),
  );

  const lead = ongoing[0] ?? upcomingFirst[0] ?? completed[0] ?? null;
  const upcoming = [...ongoing.slice(1), ...upcomingFirst].filter((trip) => trip !== lead);
  const archive = completed.filter((trip) => trip !== lead);

  return { lead, upcoming, archive };
}

export default function TripsPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [creating, setCreating] = useState(false);
  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const trips = tripsResult ?? [];
  const showSkeleton = useDelayedFlag(tripsResult === undefined);

  const { lead, upcoming, archive } = splitTrips(trips, todayStr());

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
              <span>旅行</span>
              <div><strong>登録済み</strong><b>0</b></div>
              <h2>次の旅を計画しましょう</h2>
              <p>行き先と日程を登録すると、旅程・費用・持ち物をひとつの場所で整理できます。</p>
            </div>
            <div className="destination-empty-control__action">
              <span>次の一歩</span>
              <button type="button" onClick={() => setCreating(true)}><Plus size={15} />旅行を追加</button>
            </div>
          </Card>
        ) : (
          <div className="trips-board">
            {lead && <TripLeadCard trip={lead} onDelete={handleDelete} />}

            {upcoming.length > 0 && (
              <section className="trips-board__section">
                <div data-page-block>
                  <div className="trips-head">
                    <h2>これから行く</h2>
                    <span>{upcoming.length}</span>
                  </div>
                </div>
                <div className="trip-plan-grid mt-2.5">
                  {upcoming.map((trip) => (
                    <TripPlanCard key={trip.id} trip={trip} onDelete={handleDelete} />
                  ))}
                </div>
              </section>
            )}

            {archive.length > 0 && (
              <section className="trips-board__section">
                <div data-page-block>
                  <div className="trips-head">
                    <h2>行ってきた</h2>
                    <span>{archive.length}</span>
                  </div>
                </div>
                <div className="mt-2.5">
                  <TripArchiveList trips={archive} onDelete={handleDelete} />
                </div>
              </section>
            )}
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
