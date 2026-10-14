import { useState } from "react";
import { Link } from "react-router-dom";
import { Route } from "lucide-react";
import type { TripScheduleItem } from "../../types";
import { dayModeFromTransports, dayRouteStops, LEG_MODE_LABEL, maxWaypointsForDevice, stopKeys, type LegMode } from "../../lib/tripDayRoute";
import { buildRouteEmbedUrl, buildRouteSearchUrl } from "../../lib/googleMaps";
import { resolveHomeStops, useHomeAddress } from "../../lib/homePlace";
import { formatDisplayDate } from "../../lib/date";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Tabs } from "../ui/Tabs";

interface Props {
  /** 旅行の全日程。 */
  items: TripScheduleItem[];
  /** いま日程で見ている日(YYYY-MM-DD)。 */
  date: string;
  /**
   * 地図をその場に出す(PCの日程タブの右の欄、TripDayPanel)。出さない時は、ボタンからシートで開く。
   * 横に余白のあるPCで、地図を見るたびにシートを開かせる理由は無いため。場所と移動手段の選び直しは、
   * どちらでも同じシートで行う(選んだ内容は端末に覚えるので、出し方が変わっても同じ地図になる)。
   */
  inline?: boolean;
}

/** 地図の線の手段。以前の「車/徒歩」の切り替えと同じ鍵に覚える。 */
const MODE_KEY = "lifehub.tripDayRouteMode";
/** 日ごとに本人が選んだ手段(2026-10-14)。日程の移動手段に合わせた既定より、こちらを先にする。 */
const MODE_BY_DATE_KEY = "lifehub.tripDayRouteModeByDate";
/** 外した場所。端末ごとに覚える(同期はしない)。区間ごとの手段(legs)を持っていた頃の値も読めるように同じ鍵。 */
const CHOICES_KEY = "lifehub.tripDayRouteChoices";

const MODE_OPTIONS: { value: LegMode; label: string }[] = [
  { value: "driving", label: LEG_MODE_LABEL.driving },
  { value: "walking", label: LEG_MODE_LABEL.walking },
  { value: "transit", label: LEG_MODE_LABEL.transit },
];

function isLegMode(value: unknown): value is LegMode {
  return value === "driving" || value === "walking" || value === "transit";
}

function readStoredMode(): LegMode {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return isLegMode(stored) ? stored : "driving";
  } catch {
    return "driving";
  }
}

function readModesByDate(): Record<string, LegMode> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MODE_BY_DATE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, LegMode] => isLegMode(entry[1])));
  } catch {
    return {};
  }
}

function readExcluded(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHOICES_KEY) ?? "{}") as { excluded?: unknown };
    return Array.isArray(parsed.excluded) ? parsed.excluded.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 覚えられない環境でも、選んだ内容はこの画面を開いている間は効く。
  }
}

/**
 * 見ている日の日程を、1枚の地図の経路として見せる(地点の並びは src/lib/tripDayRoute.ts)。
 *
 * 地図にピンを置くだけのマイマップと違い、Googleマップの経路なら出発地から目的地まで線でつながる。
 * ここは「その日に回る場所」の並びをそのまま渡すだけなので、日程の場所が「霊山寺」のような
 * 名前だけだと別の場所に引かれる — 都道府県・市区町村つきにする(「場所をまとめて直す」)。
 *
 * 2026-10-11 の夕方まで、区間ごとに手段を選べて、手段が変わる所と11か所ごとに「1. 車で A → B」の
 * ボタンに分けていた。本人(と一緒に行く人)から「チェックしたところまでのマップ表示に変えて、1番とか
 * いらない」「11経路までしか出ないのが気にくわない」。Googleマップを開くリンクは経由地9つまでで
 * 手段も1つだが、画面の中に埋め込む地図(buildRouteEmbedUrl)には地点の上限が無いので、チェックした
 * 場所を全部つないだ1枚を出す。手段は全体で1つ。Googleマップのアプリで開くボタンは、1本に収まる
 * 時だけ出す。
 *
 * どの場所を出すかはチェックで選ぶ(同じ日、「選択式にして、出したくないものは表示しないでほしい」)。
 * 選んだ内容は端末に覚えるので、次に開いた時もそのまま。
 */
export function TripDayRoute({ items, date, inline = false }: Props) {
  /** 手段を決めていない日(日程に移動手段が無い日)の既定。最後に選んだ手段。 */
  const [fallbackMode, setFallbackMode] = useState<LegMode>(readStoredMode);
  /** 本人が、その日の手段を選び直した記録。 */
  const [pickedModes, setPickedModes] = useState<Record<string, LegMode>>(readModesByDate);
  // 経路の手段は、日程でその日の移動に選んだ手段を基本にする(本人が選び直していれば、そちらが先)。
  const scheduleMode = dayModeFromTransports(items, date);
  const mode: LegMode = pickedModes[date] ?? scheduleMode ?? fallbackMode;
  const followsSchedule = pickedModes[date] === undefined && scheduleMode !== undefined;
  const [excludedKeys, setExcludedKeys] = useState<string[]>(readExcluded);
  /** 経路に出す場所を選ぶシートを開いているか。 */
  const [open, setOpen] = useState(false);

  // 「自宅」は設定の住所に置き換える(無ければ外す)。そのまま渡すと名前の似たお店に当たる(src/lib/homePlace.ts)。
  const homeAddress = useHomeAddress();
  const { stops, homeSkipped } = resolveHomeStops(dayRouteStops(items, date), homeAddress);
  const keys = stopKeys(date, stops);
  const excluded = new Set(excludedKeys);
  const chosen = stops.filter((_, index) => !excluded.has(keys[index]));
  const maxStops = maxWaypointsForDevice() + 2;
  // Googleマップのアプリで1本に開けるか。電車・バスは経由地を入れると調べられない(2か所だけなら開ける)。
  const fitsOneLink = chosen.length >= 2 && (mode === "transit" ? chosen.length === 2 : chosen.length <= maxStops);
  // 1か所だけなら、その場所の検索として開く(buildRouteSearchUrl が場所の検索にする)。
  const appUrl = chosen.length === 1 || fitsOneLink ? buildRouteSearchUrl(chosen, mode) : undefined;

  function changeMode(next: LegMode) {
    const nextPicked = { ...pickedModes, [date]: next };
    setPickedModes(nextPicked);
    setFallbackMode(next);
    store(MODE_BY_DATE_KEY, JSON.stringify(nextPicked));
    store(MODE_KEY, next);
  }

  /** 選び直した手段をやめて、日程の移動手段に合わせる。 */
  function followSchedule() {
    const { [date]: _dropped, ...rest } = pickedModes;
    setPickedModes(rest);
    store(MODE_BY_DATE_KEY, JSON.stringify(rest));
  }

  /** 手段の下に出す、日程との関係。日程に移動手段がある日だけ。 */
  const modeNote =
    scheduleMode === undefined ? null : followsSchedule ? (
      <p className="text-xs text-slate-500">日程の移動手段（{LEG_MODE_LABEL[scheduleMode]}）に合わせています。</p>
    ) : scheduleMode !== mode ? (
      <p className="text-xs text-slate-500">
        日程の移動手段は{LEG_MODE_LABEL[scheduleMode]}です。{" "}
        <button type="button" className="underline" onClick={followSchedule}>
          日程に合わせる
        </button>
      </p>
    ) : null;

  function toggle(index: number) {
    const key = keys[index];
    const next = excluded.has(key) ? excludedKeys.filter((k) => k !== key) : [...excludedKeys, key];
    setExcludedKeys(next);
    store(CHOICES_KEY, JSON.stringify({ excluded: next }));
  }

  const homeNote = homeSkipped && (
    <p className="px-1 text-xs text-slate-500">
      「自宅」は地図に入れていません。
      <Link to="/settings" className="underline">
        設定の「自宅の住所」
      </Link>
      を入れると、経路の出発・到着に入ります。
    </p>
  );

  if (stops.length === 0) {
    return (
      <>
        <p className="px-1 text-xs text-slate-500">
          この日は場所の入った予定がありません。日程の「場所」を入れると、経路を地図で見られます。
        </p>
        {homeNote}
      </>
    );
  }

  return (
    <>
      {inline ? (
        <div className="flex flex-col gap-2">
          {chosen.length > 0 ? (
            <div className="trip-day-route__map trip-day-route__map--inline">
              <iframe
                key={buildRouteEmbedUrl(chosen, mode)}
                title={`${formatDisplayDate(date)}の経路(地図)`}
                src={buildRouteEmbedUrl(chosen, mode)}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : (
            <p className="px-1 text-xs text-slate-500">地図に出す場所が1つも選ばれていません。</p>
          )}
          {homeNote}
          {modeNote}
          <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
            <Route size={17} />
            場所と移動手段を選ぶ
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          <Route size={17} />
          この日の経路を地図で見る
        </Button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={`${formatDisplayDate(date)}の経路`}>
        {open && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">チェックした場所を、全部つないで地図に出します。外した場所は出ません。</p>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-slate-500">移動手段</p>
              <Tabs options={MODE_OPTIONS} value={mode} onChange={changeMode} />
              {modeNote}
            </div>

            {chosen.length > 0 ? (
              <div className="trip-day-route__map">
                <iframe
                  key={buildRouteEmbedUrl(chosen, mode)}
                  title={`${formatDisplayDate(date)}の経路の地図`}
                  src={buildRouteEmbedUrl(chosen, mode)}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500">地図に出す場所が1つも選ばれていません。</p>
            )}
            {homeNote}
            {mode === "transit" && chosen.length > 2 && (
              <p className="text-xs text-slate-500">
                電車・バスは、Googleマップが3か所以上を1本の線でつなげないので、地図には場所だけが出ます。線で見たい時は「車」か「徒歩」にしてください。
              </p>
            )}

            <ol className="flex flex-col gap-1 text-sm text-slate-700" aria-label="地図に出す場所">
              {stops.map((stop, index) => {
                const off = excluded.has(keys[index]);
                return (
                  <li key={keys[index]}>
                    <label className={`flex items-start gap-2 ${off ? "text-slate-400 line-through" : ""}`}>
                      <input type="checkbox" className="mt-1" checked={!off} onChange={() => toggle(index)} />
                      <span>{stop}</span>
                    </label>
                  </li>
                );
              })}
            </ol>

            {appUrl ? (
              <Button className="w-full" onClick={() => window.open(appUrl, "_blank", "noopener,noreferrer")}>
                <Route size={17} />
                {chosen.length === 1 ? "Googleマップで場所を開く" : `Googleマップで開く（${LEG_MODE_LABEL[mode]}）`}
              </Button>
            ) : (
              chosen.length > 1 && (
                <p className="text-xs text-slate-400">
                  {mode === "transit"
                    ? "電車・バスは、Googleマップのアプリで開くと2か所の間しか調べられません。乗り換えを調べたい時は、2か所だけにチェックを残してください。"
                    : `Googleマップのアプリは、1本の経路に${maxStops}か所までしか入らないので、ボタンは出していません。全部の場所は上の地図で見られます。`}
                </p>
              )
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
