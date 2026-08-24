import { useEffect, useState } from "react";
import { Car, Footprints, Train, type LucideIcon } from "lucide-react";
import {
  FUEL_ASSUMPTION_LABEL,
  estimateFuelCostYen,
  fetchRouteInfo,
  formatDistance,
  formatDuration,
  formatMoney,
  type RouteInfoResponse,
  type RouteLegInfo,
  type RouteMode,
} from "../../lib/routeInfo";

const MODES: { value: RouteMode; label: string; icon: LucideIcon }[] = [
  { value: "walking", label: "徒歩", icon: Footprints },
  { value: "transit", label: "公共交通機関", icon: Train },
  { value: "driving", label: "車", icon: Car },
];

interface Props {
  /** 出発地。現在地の場合は「緯度,経度」の文字列。 */
  origin: string;
  destination: string;
  mode: RouteMode;
  onModeChange: (mode: RouteMode) => void;
}

/**
 * 1区間を、Googleマップのように徒歩・公共交通機関・車の3行で見せる。押すと
 * その手段の地図に切り替わる。
 *
 * 所要時間と金額は、サーバー側にGoogleのAPIキーを設定している時だけ出る
 * (src/lib/routeInfo.ts)。キーが無い場合も3行はそのまま出して、手段の選び替えと
 * Googleマップへの導線としてはこれまでどおり使えるようにしてある — 数字が出ない
 * ことを理由に選択肢ごと消すと、キーを入れるまでこの画面が退化してしまうため。
 */
export function TripLegModes({ origin, destination, mode, onModeChange }: Props) {
  const [info, setInfo] = useState<RouteInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchRouteInfo(origin, destination).then((result) => {
      if (!alive) return;
      setInfo(result);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [origin, destination]);

  const modes = info?.configured ? info.modes : undefined;
  const showsFuelEstimate = !!modes?.driving.distanceMeters;

  return (
    <div className="trip-leg-modes">
      <div role="group" aria-label="移動手段">
        {MODES.map(({ value, label, icon: Icon }) => {
          const leg = modes?.[value];
          const time = leg?.durationSeconds != null ? formatDuration(leg.durationSeconds) : null;
          const distance = leg?.distanceMeters != null ? formatDistance(leg.distanceMeters) : null;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onModeChange(value)}
              aria-pressed={mode === value}
              className={`trip-leg-mode${mode === value ? " is-active" : ""}`}
            >
              <span className="trip-leg-mode__icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="trip-leg-mode__label">{label}</span>
              <span className="trip-leg-mode__figures">
                <b>{time ?? (loading ? "…" : leg?.unavailable ? "経路なし" : "")}</b>
                <small>
                  {[distance, costLabel(value, leg)].filter(Boolean).join(" · ")}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      {showsFuelEstimate && <p className="trip-leg-modes__note">車の金額は目安です（{FUEL_ASSUMPTION_LABEL}）。</p>}
    </div>
  );
}

/** 手段ごとの「金額」。Googleが返すのは公共交通機関の運賃だけなので、徒歩は0円、
 * 車は距離からのガソリン代の概算にする。運賃は全区間のデータが揃っている経路でしか
 * 返らない(日本の路線では返らないことがある)ので、無い時は何も書かない — その場合は
 * 下の「Googleマップで開く」から本体で確かめてもらう。 */
function costLabel(mode: RouteMode, leg: RouteLegInfo | undefined): string {
  if (!leg || leg.unavailable) return "";
  if (mode === "walking") return leg.durationSeconds != null || leg.distanceMeters != null ? "0円" : "";
  if (mode === "transit") return leg.fare ? formatMoney(leg.fare) : "";
  return leg.distanceMeters != null ? `約${estimateFuelCostYen(leg.distanceMeters).toLocaleString("ja-JP")}円` : "";
}
