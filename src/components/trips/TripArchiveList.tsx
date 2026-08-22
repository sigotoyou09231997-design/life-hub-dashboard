import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { Trip } from "../../types";
import { formatDisplayDate, tripDurationLabel } from "../../lib/date";
import { tripCoverImage } from "../../lib/tripCovers";
import { TripRemoveButton } from "./TripRemoveButton";

interface Props {
  trips: Trip[];
  onDelete: (id: string) => void;
}

/** 終わった旅行は記録であって予定ではないので、これから行くものと同じ大きさを
 *  与えない。写真はサムネに落として、1枚の面の中に行として積む。 */
export function TripArchiveList({ trips, onDelete }: Props) {
  return (
    <div className="trip-archive" data-page-block>
      {trips.map((trip) => (
        <Link key={trip.id} to={`/trips/${trip.id}`} className="trip-archive__row">
          <div
            className="trip-archive__thumb"
            style={{ backgroundImage: `url('${tripCoverImage(trip.destination || trip.name)}')` }}
            aria-hidden="true"
          />
          <div className="trip-archive__copy">
            <strong>{trip.name}</strong>
            <small>
              {trip.destination && <span>{trip.destination}</span>}
              <span>
                {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)}
              </span>
              <span>{tripDurationLabel(trip.startDate, trip.endDate)}</span>
            </small>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <TripRemoveButton trip={trip} onDelete={onDelete} variant="inline" />
            <ChevronRight size={18} className="text-[color:var(--hub-ink-3)]" />
          </div>
        </Link>
      ))}
    </div>
  );
}
