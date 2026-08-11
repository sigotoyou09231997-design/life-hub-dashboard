import { Link } from "react-router-dom";
import type { Trip } from "../../types";
import { formatDisplayDate, tripDurationLabel } from "../../lib/date";
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
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <Card interactive className="flex items-center justify-between py-4">
        <div className="min-w-0">
          <p className="line-clamp-2 font-semibold text-navy" title={trip.name}>
            {trip.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-400">
            <MapPin size={12} />
            {trip.destination}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)} ・{" "}
            {tripDurationLabel(trip.startDate, trip.endDate)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
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
            className="rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
          >
            <Trash2 size={16} />
          </button>
          <ChevronRight size={18} className="text-slate-300" />
        </div>
      </Card>
    </Link>
  );
}
