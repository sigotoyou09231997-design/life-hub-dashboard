import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, TrainFront } from "lucide-react";
import { buildLegEmbedUrl, buildLegSearchUrl, type TravelMode } from "../../lib/googleMaps";
import { fetchNearestStation, type NearestStationResponse } from "../../lib/nearestStation";
import { describeWalk, findViaStation } from "../../lib/tripLegVia";
import { TripLegModes } from "./TripLegModes";

interface Props {
  /** 出発地。現在地の区間では「緯度,経度」の文字列。 */
  origin: string;
  /** 画面に出す出発地の名前(「現在地」「岡山駅」など)。 */
  originLabel: string;
  destination: string;
  destinationLabel: string;
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
  /** 地図の枠のclass。現在地のカードと区間パネルで枠(高さ)が違う。 */
  mapClassName: string;
  /** 「Googleマップで開く」のURL。行き先が経由駅に変わるので、出発地は呼び出し側が
   * 握ったまま行き先だけ受け取る形にしてある(現在地の区間は出発地を書かないリンク)。 */
  buildOpenUrl: (destination: string, mode: TravelMode) => string;
  openLabel: string;
  /** 直行のときだけ、地図を移動手段より上に出す(現在地のカードの並び)。 */
  mapFirst?: boolean;
}

/**
 * 1区間の中身(移動手段・地図・Googleマップへのリンク)。
 *
 * 公共交通機関のときは、行き先のいちばん近い駅で「電車の区間」と「駅からの徒歩」に
 * 分けて出す(src/lib/tripLegVia.ts)。新幹線から宿泊先まで1本の線で出していた頃は、
 * どの駅で降りるのかも、そこから何分歩くのかも画面に出ていなかった(2026-09-02の指摘)。
 * 分けると邪魔な区間もあるので、「直行」に戻す切り替えは残してある。
 *
 * 徒歩と車では分けない — 駅で乗り換えないので、経由させる意味が無い。
 */
export function TripLegRoute({
  origin,
  originLabel,
  destination,
  destinationLabel,
  mode,
  onModeChange,
  mapClassName,
  buildOpenUrl,
  openLabel,
  mapFirst,
}: Props) {
  const [station, setStation] = useState<NearestStationResponse | null>(null);
  /** 経由するかどうか。既定は経由する側 — 電車で行くならほぼ必ず駅で降りるため。 */
  const [wantsVia, setWantsVia] = useState(true);
  const [walkMapOpen, setWalkMapOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setStation(null);
    setWalkMapOpen(false);
    void fetchNearestStation(destination).then((next) => {
      if (active) setStation(next);
    });
    return () => {
      active = false;
    };
  }, [destination]);

  const via = findViaStation(station, { origin, originLabel, destination, destinationLabel });
  const splits = !!via && mode === "transit" && wantsVia;
  // 駅は住所で渡す(同じ名前の駅が各地にあるため)。住所が無ければ名前で引かせる。
  const viaQuery = via?.address ?? via?.name ?? "";
  const walk = describeWalk(station?.walk);

  const openLink = (to: string, linkMode: TravelMode, label: string) => (
    <a className="trip-route-leg__open" href={buildOpenUrl(to, linkMode)} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={13} />
    </a>
  );

  const modes = (
    <TripLegModes
      origin={origin}
      destination={splits ? viaQuery : destination}
      mode={mode}
      onModeChange={onModeChange}
    />
  );

  const map = (title: string, from: string, to: string, mapMode: TravelMode) => (
    <div className={mapClassName}>
      <iframe
        key={`${from}-${to}-${mapMode}`}
        title={title}
        src={buildLegEmbedUrl(from, to, mapMode)}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );

  return (
    <>
      {via && mode === "transit" && (
        <div className="trip-leg-via" role="group" aria-label="駅を経由するかどうか">
          <button
            type="button"
            className={`trip-leg-via__pick${splits ? " is-active" : ""}`}
            aria-pressed={splits}
            onClick={() => setWantsVia(true)}
          >
            <TrainFront size={13} />
            {via.name}を経由
          </button>
          <button
            type="button"
            className={`trip-leg-via__pick${splits ? "" : " is-active"}`}
            aria-pressed={!splits}
            onClick={() => setWantsVia(false)}
          >
            直行
          </button>
        </div>
      )}

      {splits ? (
        <ol className="trip-leg-via__steps">
          <li>
            <p className="trip-leg-via__step">
              <span aria-hidden="true">1</span>
              {originLabel} → {via.name}
            </p>
            {modes}
            {map(`${originLabel}から${via.name}までの経路`, origin, viaQuery, mode)}
            {openLink(viaQuery, mode, openLabel)}
          </li>
          <li>
            <p className="trip-leg-via__step">
              <span aria-hidden="true">2</span>
              {via.name} → {destinationLabel}
            </p>
            {/* 駅からの徒歩は地図を畳んでおく。区間ごとに地図が2枚に増えると、
                場所の多い旅行でルート画面が重くなるため。 */}
            <button
              type="button"
              className="trip-leg-via__walk"
              aria-expanded={walkMapOpen}
              onClick={() => setWalkMapOpen((open) => !open)}
            >
              <span>{walk || "駅からの道を見る"}</span>
              <ChevronDown size={13} className={walkMapOpen ? "is-open" : undefined} />
            </button>
            {walkMapOpen && map(`${via.name}から${destinationLabel}までの徒歩の経路`, viaQuery, destination, "walking")}
            <a
              className="trip-route-leg__open"
              href={buildLegSearchUrl(viaQuery, destination, "walking")}
              target="_blank"
              rel="noreferrer"
            >
              駅からの道をGoogleマップで見る
              <ExternalLink size={13} />
            </a>
          </li>
        </ol>
      ) : mapFirst ? (
        <>
          {map(`${originLabel}から${destinationLabel}までの経路`, origin, destination, mode)}
          {modes}
          {openLink(destination, mode, openLabel)}
        </>
      ) : (
        <>
          {modes}
          {map(`${originLabel}から${destinationLabel}までの経路`, origin, destination, mode)}
          {openLink(destination, mode, openLabel)}
        </>
      )}
    </>
  );
}
