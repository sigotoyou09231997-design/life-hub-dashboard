import { useState } from "react";
import { Route } from "lucide-react";
import type { TripScheduleItem } from "../../types";
import {
  buildSegmentLinks,
  dayRouteStops,
  hintFor,
  LEG_MODE_LABEL,
  legKey,
  stopKeys,
  transportHints,
  type LegMode,
} from "../../lib/tripDayRoute";
import { formatDisplayDate } from "../../lib/date";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Tabs } from "../ui/Tabs";

interface Props {
  /** 旅行の全日程。 */
  items: TripScheduleItem[];
  /** いま日程で見ている日(YYYY-MM-DD)。 */
  date: string;
}

/** 区間ごとに選ばなかったときの手段。以前の「車/徒歩」の切り替えと同じ鍵に覚える。 */
const MODE_KEY = "lifehub.tripDayRouteMode";
/** 区間ごとに選んだ手段と、外した場所。端末ごとに覚える(同期はしない)。 */
const CHOICES_KEY = "lifehub.tripDayRouteChoices";

const MODE_OPTIONS: { value: LegMode; label: string }[] = [
  { value: "driving", label: LEG_MODE_LABEL.driving },
  { value: "walking", label: LEG_MODE_LABEL.walking },
  { value: "transit", label: LEG_MODE_LABEL.transit },
];

interface Choices {
  legs: Record<string, LegMode>;
  excluded: string[];
}

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

function readChoices(): Choices {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHOICES_KEY) ?? "{}") as Partial<Choices>;
    const legs = Object.fromEntries(Object.entries(parsed.legs ?? {}).filter(([, mode]) => isLegMode(mode)));
    return { legs, excluded: Array.isArray(parsed.excluded) ? parsed.excluded.filter((k) => typeof k === "string") : [] };
  } catch {
    return { legs: {}, excluded: [] };
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 覚えられない環境でも、選んだ手段はこの画面を開いている間は効く。
  }
}

/** ボタンに出す短い名前。「霊山寺 徳島県鳴門市大麻町」の地域の部分は省く。 */
function shortName(place: string): string {
  return place.split(/\s+/).find((token) => token) ?? place;
}

/**
 * 見ている日の日程を、Googleマップの経路として開く(経路の作りは src/lib/tripDayRoute.ts)。
 *
 * 地図にピンを置くだけのマイマップと違い、Googleマップ本体なら出発地から目的地まで線でつながる。
 * ここは「その日に回る場所」の並びをそのまま渡すだけなので、日程の場所が「霊山寺」のような
 * 名前だけだと別の場所に引かれる — 都道府県・市区町村つきにする(「場所をまとめて直す」)。
 *
 * 移動手段は区間(場所から場所)ごとに選べる(2026-10-11、「徒歩とか車とかが場所移動ごとに
 * 変えられたらいい」)。Googleマップの1本の経路は手段を1つしか持てないので、手段が変わる所で
 * ボタンが分かれる。
 *
 * 押すと、まず「どの場所を経路に出すか」を選ぶシートを開く(同じ日、「選択式にして、出したく
 * ないものは表示しないでほしい」)。外した場所はGoogleマップの経路に入らない。選んだ内容は
 * 端末に覚えるので、次に開いた時もそのまま。
 */
export function TripDayRoute({ items, date }: Props) {
  const [defaultMode, setDefaultMode] = useState<LegMode>(readStoredMode);
  const [choices, setChoices] = useState<Choices>(readChoices);
  /** 経路に出す場所を選ぶシートを開いているか。 */
  const [open, setOpen] = useState(false);

  const stops = dayRouteStops(items, date);
  const keys = stopKeys(date, stops);
  const excluded = new Set(choices.excluded);
  const chosenIndexes = stops.map((_, index) => index).filter((index) => !excluded.has(keys[index]));
  const chosen = chosenIndexes.map((index) => stops[index]);
  // 区間の手段は、本人が選んだもの → 予定の「移動手段」(新幹線なら電車・バス) → 全体の既定 の順。
  const hints = transportHints(items, date);
  const legModes = chosen
    .slice(0, -1)
    .map((from, i) => choices.legs[legKey(date, from, chosen[i + 1])] ?? hintFor(hints, from) ?? defaultMode);
  const links = buildSegmentLinks(chosen, legModes);

  function save(next: Choices) {
    setChoices(next);
    store(CHOICES_KEY, JSON.stringify(next));
  }

  function changeDefault(next: LegMode) {
    setDefaultMode(next);
    store(MODE_KEY, next);
  }

  function changeLeg(from: string, to: string, mode: LegMode) {
    save({ ...choices, legs: { ...choices.legs, [legKey(date, from, to)]: mode } });
  }

  function toggle(index: number) {
    const key = keys[index];
    save({
      ...choices,
      excluded: excluded.has(key) ? choices.excluded.filter((k) => k !== key) : [...choices.excluded, key],
    });
  }

  function openUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function linkLabel(index: number): string {
    const link = links[index];
    if (links.length === 1) {
      return chosen.length === 1 ? "Googleマップで場所を開く" : `Googleマップで開く（${LEG_MODE_LABEL[link.mode]}）`;
    }
    return `${index + 1}. ${LEG_MODE_LABEL[link.mode]}で ${shortName(link.from)} → ${shortName(link.to)}`;
  }

  if (stops.length === 0) {
    return (
      <p className="px-1 text-xs text-slate-500">
        この日は場所の入った予定がありません。日程の「場所」を入れると、経路をGoogleマップで開けます。
      </p>
    );
  }

  return (
    <>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        <Route size={17} />
        この日の経路をGoogleマップで開く
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${formatDisplayDate(date)}の経路`}>
        {open && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              経路に出す場所を選んでください。チェックを外した場所は、Googleマップの経路に出ません。
            </p>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-slate-500">移動手段（区間ごとにも変えられます）</p>
              <Tabs options={MODE_OPTIONS} value={defaultMode} onChange={changeDefault} />
            </div>

            <ol className="flex flex-col gap-1 text-sm text-slate-700" aria-label="経路に出す場所">
              {stops.map((stop, index) => {
                const position = chosenIndexes.indexOf(index);
                const from = position > 0 ? chosen[position - 1] : null;
                return (
                  <li key={keys[index]} className="flex flex-col gap-1">
                    {from !== null && (
                      <label className="ml-6 flex items-center gap-2 text-xs text-slate-500">
                        <span aria-hidden="true">↓</span>
                        <select
                          aria-label={`${shortName(from)} → ${shortName(stop)} の移動手段`}
                          className="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-xs text-slate-700"
                          value={legModes[position - 1]}
                          onChange={(e) => changeLeg(from, stop, e.target.value as LegMode)}
                        >
                          {MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className={`flex items-start gap-2 ${position === -1 ? "text-slate-400 line-through" : ""}`}>
                      <input type="checkbox" className="mt-1" checked={position !== -1} onChange={() => toggle(index)} />
                      <span>{stop}</span>
                    </label>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-col gap-2">
              {links.map((link, index) => (
                <Button key={`${index}-${link.url}`} className="w-full" onClick={() => openUrl(link.url)}>
                  <Route size={17} />
                  {linkLabel(index)}
                </Button>
              ))}
              {links.length === 0 && <p className="text-xs text-slate-500">経路に出す場所が1つも選ばれていません。</p>}
              {links.length > 1 && (
                <p className="text-xs text-slate-500">
                  Googleマップの1本の経路は、移動手段を1つしか持てず、地点の数にも上限があるので、分けています。前の経路の終点が、次の経路の始点です。
                </p>
              )}
              <p className="text-xs text-slate-400">
                電車・バスは、Googleマップが経由地をまとめて調べられないので、1区間ずつ開きます。
              </p>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
