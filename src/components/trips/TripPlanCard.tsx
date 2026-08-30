import { Link } from "react-router-dom";
import { CalendarRange, MapPin } from "lucide-react";
import type { Trip } from "../../types";
import { formatDisplayDate, tripCountdownLabel, tripDurationLabel } from "../../lib/date";
import { useTripCover } from "../../hooks/useTripCover";
import { TripRemoveButton } from "./TripRemoveButton";

interface Props {
  trip: Trip;
  onDelete: (id: string) => void;
}

/** これから行く旅行。先頭の1件は TripLeadCard が大きく持っていくので、
 *  ここは2列(広い画面で3列)の中カード。 */
export function TripPlanCard({ trip, onDelete }: Props) {
  const countdown = tripCountdownLabel(trip.startDate, trip.endDate);
  const cover = useTripCover(trip.name, trip.destination ?? "");

  return (
    <Link to={`/trips/${trip.id}`} className="trip-plan hub-tap" data-page-block>
      <div
        className="trip-plan__photo"
        style={{ backgroundImage: `url('${cover.url}')` }}
        aria-hidden="true"
      />
      <div className="trip-plan__veil" aria-hidden="true" />

      <TripRemoveButton trip={trip} onDelete={onDelete} />

      {countdown && <span className="trip-plan__countdown">{countdown}</span>}
      <h3 className="trip-plan__name">{trip.name}</h3>
      <p className="trip-plan__meta">
        {trip.destination && (
          <span>
            <MapPin size={13} />
            {trip.destination}
          </span>
        )}
        <span>
          <CalendarRange size={13} />
          {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)}
        </span>
        <span>{tripDurationLabel(trip.startDate, trip.endDate)}</span>
      </p>
    </Link>
  );
}
