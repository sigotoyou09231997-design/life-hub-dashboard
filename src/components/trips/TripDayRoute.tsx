import { useEffect, useState } from "react";
import { Route } from "lucide-react";
import type { TripScheduleItem } from "../../types";
import { buildRouteLinks, dayRouteStops, type DayRouteMode } from "../../lib/tripDayRoute";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";

interface Props {
  /** 旅行の全日程。 */
  items: TripScheduleItem[];
  /** いま日程で見ている日(YYYY-MM-DD)。 */
  date: string;
}

const MODE_KEY = "lifehub.tripDayRouteMode";

const MODE_OPTIONS: { value: DayRouteMode; label: string }[] = [
  { value: "driving", label: "車" },
  { value: "walking", label: "徒歩" },
];

function readStoredMode(): DayRouteMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "walking" ? "walking" : "driving";
  } catch {
    return "driving";
  }
}

/**
 * 見ている日の日程を、Googleマップの経路として開く(経路の作りは src/lib/tripDayRoute.ts)。
 *
 * 地図にピンを置くだけのマイマップと違い、Googleマップ本体なら出発地から目的地まで線でつながる。
 * ここは「その日に回る場所」の並びをそのまま渡すだけなので、日程の場所が「霊山寺」のような
 * 名前だけだと別の場所に引かれる — 都道府県・市区町村つきにする(「場所をまとめて直す」)。
 *
 * 1日の中には電車やフェリーの区間も入る(四国の旅行なら、1日目の小金井→岡山や5日目の高松港→
 * 土庄港)。それを車の経路に混ぜると、電車で行く所まで車で走る線になるので、回る場所を
 * 1つずつ外せるようにしてある。外した場所は、その日を開き直すまで覚えている(日が変わると全部戻る)。
 */
export function TripDayRoute({ items, date }: Props) {
  const [mode, setMode] = useState<DayRouteMode>(readStoredMode);
  const stops = dayRouteStops(items, date);
  /** 外した地点の、stops の中での位置。同じ場所が2度出る日(桂浜 → 海津見神社 → 桂浜)もあるので、名前ではなく位置で持つ。 */
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const stopsKey = stops.join("\n");
  useEffect(() => setExcluded(new Set()), [stopsKey]);

  const chosen = stops.filter((_, index) => !excluded.has(index));
  const links = buildRouteLinks(chosen, mode);

  function changeMode(next: DayRouteMode) {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // 覚えられない環境でも、切り替え自体は動く。
    }
  }

  function toggle(index: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  function open(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-2">
      <Tabs options={MODE_OPTIONS} value={mode} onChange={changeMode} />

      {stops.length === 0 ? (
        <p className="px-1 text-xs text-slate-500">
          この日は場所の入った予定がありません。日程の「場所」を入れると、経路を開けます。
        </p>
      ) : (
        <>
          {links.map((link, index) => (
            <Button key={link.url} variant="secondary" className="w-full" onClick={() => open(link.url)}>
              <Route size={17} />
              {links.length > 1
                ? `経路 ${index + 1}/${links.length} をGoogleマップで開く（${link.count}地点）`
                : chosen.length === 1
                  ? "この日の場所をGoogleマップで開く"
                  : "この日の経路をGoogleマップで開く"}
            </Button>
          ))}
          {links.length === 0 && <p className="px-1 text-xs text-slate-500">回る場所が1つも選ばれていません。</p>}
          {links.length > 1 && (
            <p className="px-1 text-xs text-slate-500">
              地点が多いので、Googleマップが受け付ける数ごとに分けています。前の経路の終点が、次の経路の始点です。
            </p>
          )}
          {chosen.length > 0 && <p className="px-1 text-xs text-slate-500">{chosen.join(" → ")}</p>}

          <details className="px-1 text-sm text-slate-600">
            <summary className="cursor-pointer text-xs text-slate-500">
              回る場所を選ぶ（{chosen.length}/{stops.length}か所）
            </summary>
            <ul className="mt-1.5 flex flex-col gap-1">
              {stops.map((stop, index) => (
                <li key={index}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!excluded.has(index)}
                      onChange={() => toggle(index)}
                    />
                    <span>{stop}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-slate-400">
              電車やフェリーで行く区間の場所は、外してください。
            </p>
          </details>
        </>
      )}
      <p className="px-1 text-xs text-slate-400">
        電車・バスは経由地を入れて調べられないので、ルートタブの区間ごとの経路を使ってください。
      </p>
    </div>
  );
}
