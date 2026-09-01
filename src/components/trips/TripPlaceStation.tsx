import { useEffect, useState } from "react";
import { ChevronDown, TrainFront } from "lucide-react";
import { buildLegEmbedUrl } from "../../lib/googleMaps";
import { formatDistance, formatDuration } from "../../lib/routeInfo";
import { describeNearestStation, fetchNearestStation, type NearestStationResponse } from "../../lib/nearestStation";

interface Props {
  placeName: string;
  address: string;
}

/**
 * 行きたい場所1件の「いちばん近い駅から徒歩何分か」。押すと駅からの道が地図で開く。
 *
 * 駅が見つからない時・APIキーを用意していない時は、何も出さずに畳む — 出せない理由を
 * 場所ごとに並べても、ルートを見る役には立たないため(src/lib/nearestStation.ts)。
 * 地図は押した時だけ読み込む。場所の数だけ地図を先に並べると、ルート画面が重くなる。
 */
export function TripPlaceStation({ placeName, address }: Props) {
  const [result, setResult] = useState<NearestStationResponse | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setResult(null);
    setMapOpen(false);
    void fetchNearestStation(address).then((next) => {
      if (active) setResult(next);
    });
    return () => {
      active = false;
    };
  }, [address]);

  const station = result?.station;
  if (!station) return null;

  const label = describeNearestStation(station, result?.walk, {
    duration: formatDuration,
    distance: formatDistance,
  });

  return (
    <div className="trip-route-card__station">
      <button
        type="button"
        className="trip-route-card__station-toggle"
        onClick={() => setMapOpen((open) => !open)}
        aria-expanded={mapOpen}
      >
        <TrainFront size={13} />
        <span>最寄り駅 {label}</span>
        <ChevronDown size={13} className={mapOpen ? "is-open" : undefined} />
      </button>
      {mapOpen && (
        <div className="trip-route-card__station-map">
          <iframe
            title={`${station.name}から${placeName}までの徒歩の経路`}
            src={buildLegEmbedUrl(station.address ?? station.name, address, "walking")}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}
    </div>
  );
}
