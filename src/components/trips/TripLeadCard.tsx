import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarRange, MapPin, Plane } from "lucide-react";
import { db } from "../../db/schema";
import type { Trip } from "../../types";
import { formatDisplayDate, todayStr, tripCountdownLabel, tripDurationLabel } from "../../lib/date";
import { tripCoverImage } from "../../lib/tripCovers";
import { occurringOn } from "../../lib/eventSpan";
import { TripRemoveButton } from "./TripRemoveButton";

interface Props {
  trip: Trip;
  onDelete: (id: string) => void;
}

/** 金額は必ず全部出す。万で丸めない(過去に丸めて差し戻された)。 */
function yen(value: number): string {
  return `¥${value.toLocaleString("ja-JP")}`;
}

/**
 * 一覧のいちばん上に1件だけ置く大きなカード。いま行っている旅行、無ければ
 * 次に行く旅行。写真を主役にしつつ、絵だけで終わらないように旅程・費用・
 * 持ち物の実データを同じカードの中で名乗らせる。
 */
export function TripLeadCard({ trip, onDelete }: Props) {
  const today = todayStr();
  const ongoing = trip.status === "ongoing";

  const stats = useLiveQuery(async () => {
    if (!trip.id) return null;
    const [schedule, expenses, packing] = await Promise.all([
      db.tripSchedule.where("tripId").equals(trip.id).toArray(),
      db.tripExpenses.where("tripId").equals(trip.id).toArray(),
      db.tripPackingItems.where("tripId").equals(trip.id).toArray(),
    ]);
    return {
      // 旅行中は「今日ぶんが何件あるか」が知りたい情報で、出発前は旅程全体の厚み。
      plans: ongoing ? occurringOn(schedule, today).length : schedule.length,
      spent: expenses.reduce((sum, expense) => sum + expense.amount, 0),
      packed: packing.filter((item) => item.checked).length,
      packing: packing.length,
    };
  }, [trip.id, ongoing, today]);

  const countdown = tripCountdownLabel(trip.startDate, trip.endDate, today);

  return (
    <Link to={`/trips/${trip.id}`} className="trip-lead hub-tap" data-page-block>
      <div
        className="trip-lead__photo"
        style={{ backgroundImage: `url('${tripCoverImage(trip.destination || trip.name)}')` }}
        aria-hidden="true"
      />
      <div className="trip-lead__veil" aria-hidden="true" />

      <TripRemoveButton trip={trip} onDelete={onDelete} />

      <div className="trip-lead__top">
        <span className="trip-lead__kicker">
          <Plane size={14} />
          {ongoing ? "旅行中" : "次の旅行"}
        </span>
        {countdown && <span className="trip-lead__countdown">{countdown}</span>}
      </div>

      <h2 className="trip-lead__name">{trip.name}</h2>

      <p className="trip-lead__meta">
        {trip.destination && (
          <span>
            <MapPin size={14} />
            {trip.destination}
          </span>
        )}
        <span>
          <CalendarRange size={14} />
          {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)}
        </span>
        <span>{tripDurationLabel(trip.startDate, trip.endDate)}</span>
      </p>

      <div className="trip-lead__stats">
        <div className="trip-lead__stat">
          <small>{ongoing ? "今日の予定" : "旅程"}</small>
          <strong>{stats ? `${stats.plans}件` : "—"}</strong>
        </div>
        <div className="trip-lead__stat">
          <small>使った額</small>
          <strong>{stats ? yen(stats.spent) : "—"}</strong>
          {trip.budget ? <b>予算 {yen(trip.budget)}</b> : null}
        </div>
        <div className="trip-lead__stat">
          <small>持ち物</small>
          <strong>{stats ? `${stats.packed} / ${stats.packing}` : "—"}</strong>
        </div>
      </div>
    </Link>
  );
}
