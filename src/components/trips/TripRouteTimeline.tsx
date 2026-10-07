import { Fragment, useEffect, useState } from "react";
import { Car, Footprints, Train, type LucideIcon } from "lucide-react";
import { fetchRouteInfo, formatDuration, type RouteInfoResponse, type RouteMode } from "../../lib/routeInfo";
import { estimateArrival, gapMinutes, type TimelineStop } from "../../lib/tripRouteTimeline";

const MODE_LABEL: Record<RouteMode, { label: string; icon: LucideIcon }> = {
  walking: { label: "徒歩", icon: Footprints },
  transit: { label: "公共交通機関", icon: Train },
  driving: { label: "車", icon: Car },
};

interface Props {
  /** 回る順に並んだ、その日の場所(時刻つき)。 */
  stops: TimelineStop[];
  /** 区間の移動手段。地図の画面で選んだものをそのまま使う(区間の始点の場所idで引く)。 */
  modeOf: (placeId: string) => RouteMode;
}

/**
 * ルートを時間の流れで見せる。左に時刻、右に場所、場所と場所のあいだに移動時間。
 *
 * 時刻は日程から借りたもの(src/lib/tripRouteTimeline.ts)なので、ここでは直せない。
 * 移動時間はサーバー側のGoogleのキーで取れた時だけ出る(キーが無い・取れない時は
 * 時刻だけの並びになる)。数字が出ないことを理由に、この見方ごと消さない。
 */
export function TripRouteTimeline({ stops, modeOf }: Props) {
  return (
    <ol className="trip-rtime">
      {stops.map((stop, i) => {
        const next = stops[i + 1];
        const { place } = stop;
        return (
          <Fragment key={place.id}>
            <li className="trip-rtime__stop">
              <div className={`trip-rtime__time${stop.startTime ? "" : " is-none"}`}>
                <b>{stop.startTime ?? "時刻なし"}</b>
                {stop.endTime && <small>〜{stop.endTime}</small>}
              </div>
              <span className={`trip-rtime__dot${place.visited ? " is-visited" : ""}`} aria-hidden="true" />
              <div className="trip-rtime__body">
                <h3>{place.name}</h3>
                {stop.title && <p className="trip-rtime__title">{stop.title}</p>}
                <p className="trip-rtime__address" title={place.address}>{place.address}</p>
                {place.memo && <p className="trip-rtime__memo">{place.memo}</p>}
              </div>
            </li>
            {next && <TimelineMove from={stop} to={next} mode={modeOf(place.id ?? "")} />}
          </Fragment>
        );
      })}
    </ol>
  );
}

/** 場所と場所のあいだ。移動時間・次の予定までの余り・着く目安を、分かるものだけ出す。 */
function TimelineMove({ from, to, mode }: { from: TimelineStop; to: TimelineStop; mode: RouteMode }) {
  const [info, setInfo] = useState<RouteInfoResponse | null>(null);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    void fetchRouteInfo(from.place.address, to.place.address).then((result) => {
      if (alive) setInfo(result);
    });
    return () => {
      alive = false;
    };
  }, [from.place.address, to.place.address]);

  const leg = info?.configured ? info.modes?.[mode] : undefined;
  const seconds = leg && !leg.unavailable ? leg.durationSeconds : undefined;
  const gap = gapMinutes(from, to);
  // 次の場所に時刻が入っている時は、その時刻が正しいので、目安は出さない。
  const arrival = to.startTime ? undefined : estimateArrival(from, seconds);
  const tight = gap != null && (gap <= 0 || (seconds != null && Math.ceil(seconds / 60) > gap));
  const { label, icon: Icon } = MODE_LABEL[mode];

  const parts: string[] = [];
  if (seconds != null) parts.push(`${label} ${formatDuration(seconds)}`);
  if (gap != null && gap > 0) parts.push(`次の予定まで${formatDuration(gap * 60)}`);
  if (arrival) parts.push(`${arrival}ごろ着`);

  return (
    <li className={`trip-rtime__move${tight ? " is-tight" : ""}`}>
      {(parts.length > 0 || tight) && (
        <p>
          {seconds != null && <Icon size={14} aria-hidden="true" />}
          <span>{parts.join(" ・ ")}</span>
          {tight && <strong>{gap != null && gap <= 0 ? "予定が重なっています" : "時間が足りないかもしれません"}</strong>}
        </p>
      )}
    </li>
  );
}
