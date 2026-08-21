import { Link } from "react-router-dom";
import type { Trip } from "../../types";
import { formatDisplayDate, tripDurationLabel } from "../../lib/date";
import { tripCoverImage } from "../../lib/tripCovers";
import { Card } from "../ui/Card";
import { ChevronRight, MapPin, Trash2 } from "lucide-react";

interface Props {
  trip: Trip;
  onDelete: (id: string) => void;
}

export function TripCard({ trip, onDelete }: Props) {
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <Card interactive className={`trip-module trip-module--${trip.status} flex min-h-[190px] items-end justify-between overflow-hidden py-4`}>
        <div
          className="trip-module__photo"
          style={{ backgroundImage: `url('${tripCoverImage(trip.destination || trip.name)}')` }}
          aria-hidden="true"
        />
        <div className="trip-module__veil" aria-hidden="true" />
        <div className="trip-module__content min-w-0">
          <p className="line-clamp-2 font-semibold text-navy" title={trip.name}>
            {trip.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-200">
            <MapPin size={12} />
            {trip.destination}
          </p>
          <p className="mt-1 text-xs text-slate-200">
            {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)}
          </p>
          {/* 泊数を日程に続けて書くと、3列に並べたときに「3泊4/日」で割れる。
              HOMEの旅行タイルと同じくチップとして独立させる。 */}
          <span className="trip-module__duration">{tripDurationLabel(trip.startDate, trip.endDate)}</span>
        </div>
        <div className="trip-module__actions flex shrink-0 items-center gap-1">
          <button
            onClick={(e) => {
              e.preventDefault();
              if (
                trip.id &&
                confirm(`「${trip.name}」を削除しますか?関連するスケジュール・費用・持ち物もすべて削除されます。`)
              ) {
                onDelete(trip.id);
              }
            }}
            aria-label="削除"
            className="rounded-full p-1.5 text-white/70 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
          >
            <Trash2 size={16} />
          </button>
          <ChevronRight size={18} className="text-white/70" />
        </div>
      </Card>
    </Link>
  );
}
