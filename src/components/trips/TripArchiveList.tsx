import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { Trip } from "../../types";
import { formatDisplayDate, tripDurationLabel } from "../../lib/date";
import { useTripCover } from "../../hooks/useTripCover";
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
        <TripArchiveRow key={trip.id} trip={trip} onDelete={onDelete} />
      ))}
    </div>
  );
}

/** 1行ぶん。行ごとに表紙写真を用意する（フックは行の単位で呼ぶ必要があるので、
 * map の中に直接書かずコンポーネントに切り出している）。 */
function TripArchiveRow({ trip, onDelete }: { trip: Trip; onDelete: (id: string) => void }) {
  const cover = useTripCover(trip.name, trip.destination ?? "");

  return (
    <Link to={`/trips/${trip.id}`} className="trip-archive__row">
      <div
        className="trip-archive__thumb"
        style={{ backgroundImage: `url('${cover.url}')` }}
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
  );
}
