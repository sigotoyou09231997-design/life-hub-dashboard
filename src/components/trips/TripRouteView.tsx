import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  Check,
  ExternalLink,
  LocateFixed,
  Map,
  MoveDown,
  MoveUp,
  Pencil,
  Plus,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Clock,
  Search,
  Trash2,
} from "lucide-react";
import { db } from "../../db/schema";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import type { RouteSuggestion } from "../../lib/tripRouteSuggestions";
import {
  buildMapEmbedUrl,
  buildLegSearchUrl,
  buildRouteSearchUrl,
  buildFromHereSearchUrl,
  coordsQuery,
} from "../../lib/googleMaps";
import type { TravelMode } from "../../lib/googleMaps";
import { formatShortDate } from "../../lib/date";
import { TripRouteForm } from "./TripRouteForm";
import { TripLegRoute } from "./TripLegRoute";
import { TripRouteTimeline } from "./TripRouteTimeline";
import { buildRouteTimeline, findSourceSchedule } from "../../lib/tripRouteTimeline";
import { dayModeFromTransports, hintFor, transportHints } from "../../lib/tripDayRoute";
import { planAddressReflect } from "../../lib/tripRouteFollow";
import { isRouteLinked, setRouteLinked } from "../../lib/routeLink";
import { TripPlaceStation } from "./TripPlaceStation";
import { readHiddenPlaceIds, toggleHiddenPlace, writeHiddenPlaceIds } from "../../lib/tripRouteSelection";

interface Props {
  tripId: string;
  destination: string;
  /** 並べ替え済み(sortOrder昇順)で渡すこと。 */
  places: TripRoutePlace[];
  /** 日程の場所を押して来た時の、見せる場所。その場所の日に切り替え、そこまで送って光らせる。 */
  focus?: { id: string; at: number } | null;
  /** 旅行の全日程(YYYY-MM-DD)。日にちの切り替えに使う。 */
  dayList: string[];
  /** 旅行の日程。「時間で見る」で、場所に時刻を付けるのに使う。無くても動く(時刻なしで並ぶ)。 */
  schedule?: TripScheduleItem[];
  /** 日程には入っているのに、ルートにはまだ無い場所(src/lib/tripRouteSuggestions.ts)。
   * 日にちの切り替えに合わせて、その日のぶんだけ出す。 */
  suggestions: RouteSuggestion[];
  /** 候補をルートに入れる。まとめて入れられるよう配列で渡す(回る順を続き番号で
   * 振るので、1件ずつ呼ぶと同じ番号が並んでしまう)。 */
  onAddSuggestions: (suggestions: RouteSuggestion[]) => void;
  onAdd: () => void;
  /** 1件目をこの画面の中で保存し終えたとき(空のとき出すフォーム用)。 */
  onFirstSaved: () => void;
  onEdit: (place: TripRoutePlace) => void;
  onDelete: (id: string) => void;
  /** ルートの場所の元になった日程を開く(2026-10-14、要望「ルートの予定を選択して元になった予定を開くことができると効率的」)。
   * 渡さなければ、ボタンは出さない。 */
  onOpenSchedule?: (item: TripScheduleItem) => void;
}

/** 現在地から1つ目の場所までの区間につける鍵。場所idと混ざらない名前にしてある。 */
const HERE_LEG = "here";
const DEFAULT_MODE: TravelMode = "transit";
/** 日にちの切り替えで「全部見る」と「日付を決めていない場所」を表す値。 */
const ALL_DAYS = "all";
const NO_DAY = "none";

/** ルートの見方。「地図」は場所ごとの地図と経路、「時間」は時刻と移動時間の縦の並び。 */
type RouteViewMode = "map" | "time";
const VIEW_KEY = "lifehub.tripRouteView";
/** 「日程に入っている場所」の候補を、畳んでいるか。ふだんは開いたまま(畳んだ人だけ、次に開いた時も畳んだまま)。 */
const PICKS_FOLDED_KEY = "lifehub.tripRoutePicksFolded";

function readPicksFolded(): boolean {
  try {
    return window.localStorage.getItem(PICKS_FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

function readStoredView(): RouteViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "time" ? "time" : "map";
  } catch {
    return "map";
  }
}

/**
 * 日程に入っているのに、ルートにはまだ無い場所を並べる。
 *
 * 日程とルートは別の表なので、日程に予定を入れてもルートは空のままだった。
 * 「1日目に新幹線の予定を入れてあるのに、ルートの1日目が空なのはおかしい」
 * という指摘(2026-08-27)への答えがここ。勝手にルートへ足さないのは、ルートが
 * 「回る順」を持つ並びで、日程を丸ごと流し込むと順番の意味が薄れるため。
 */
function TripRoutePicks({
  suggestions,
  onAdd,
}: {
  suggestions: RouteSuggestion[];
  onAdd: (suggestions: RouteSuggestion[]) => void;
}) {
  /** チェックを付けた候補(日程の予定の id)。 */
  const [selected, setSelected] = useState<string[]>([]);
  /** 見出しを押して畳んだ状態(2026-10-15、要望「ルートの『日程に入っている場所』を、タップで閉じたり開いたりしてほしい」)。 */
  const [folded, setFolded] = useState(readPicksFolded);
  if (suggestions.length === 0) return null;

  // 日にちを切り替えた・ルートに入れた後に、もう候補に無いものの選びは外す。
  const chosen = suggestions.filter((suggestion) => selected.includes(suggestion.scheduleId));
  const canSelect = suggestions.length > 1;
  const allSelected = chosen.length === suggestions.length;
  const toggle = (scheduleId: string) =>
    setSelected((current) => (current.includes(scheduleId) ? current.filter((id) => id !== scheduleId) : [...current, scheduleId]));
  const toggleFolded = () => {
    const next = !folded;
    setFolded(next);
    try {
      window.localStorage.setItem(PICKS_FOLDED_KEY, next ? "1" : "0");
    } catch {
      // 覚えられなくても、開け閉めはできる
    }
  };

  return (
    <section className={`trip-route-picks${folded ? " is-folded" : ""}`}>
      {/* 見出しの全体が押せる。畳んでも件数は見えるので、「まだ入れていない場所がある」ことは分かる。 */}
      <h3 className="trip-route-picks__head">
        <button
          type="button"
          className="trip-route-picks__toggle"
          aria-expanded={!folded}
          aria-controls="trip-route-picks-body"
          onClick={toggleFolded}
        >
          <span className="trip-route-picks__icon" aria-hidden="true"><CalendarPlus size={16} /></span>
          <span className="trip-route-picks__title">日程に入っている場所</span>
          <b>{suggestions.length}</b>
          <ChevronDown size={18} className="trip-route-picks__chevron" aria-hidden="true" />
        </button>
      </h3>
      <div id="trip-route-picks-body" className="trip-route-picks__content" hidden={folded}>
        <p className="trip-route-picks__lead">
          日程にはあるのに、ルートにはまだ入っていない場所です。入れると地図と経路が並びます。
          {canSelect && "いくつかあるときは、チェックして、選んだものだけを入れられます。"}
        </p>
        <ul className="trip-route-picks__list">
          {suggestions.map((suggestion) => (
            <li key={suggestion.scheduleId}>
              {canSelect && (
                <input
                  type="checkbox"
                  className="trip-route-picks__check"
                  checked={selected.includes(suggestion.scheduleId)}
                  onChange={() => toggle(suggestion.scheduleId)}
                  aria-label={`${suggestion.name}を選ぶ`}
                />
              )}
              <div className="trip-route-picks__body">
                <p className="trip-route-picks__name" title={suggestion.address}>{suggestion.name}</p>
                <small>
                  {formatShortDate(suggestion.date)}
                  {suggestion.startTime ? ` ${suggestion.startTime}` : ""}・{suggestion.title}
                </small>
              </div>
              <button type="button" onClick={() => onAdd([suggestion])}>
                <Plus size={15} />
                入れる
              </button>
            </li>
          ))}
        </ul>
        {canSelect && (
          <div className="trip-route-picks__actions">
            <button
              type="button"
              className="trip-route-picks__all"
              onClick={() => setSelected(allSelected ? [] : suggestions.map((suggestion) => suggestion.scheduleId))}
            >
              {allSelected ? "選びをやめる" : "すべて選ぶ"}
            </button>
            {chosen.length > 0 ? (
              <button
                type="button"
                className="trip-route-picks__all trip-route-picks__all--primary"
                onClick={() => {
                  onAdd(chosen);
                  setSelected([]);
                }}
              >
                選んだ{chosen.length}件をルートに入れる
              </button>
            ) : (
              <button type="button" className="trip-route-picks__all" onClick={() => onAdd(suggestions)}>
                すべてルートに入れる
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 行きたい場所を「地図 → 矢印 → 地図」の鎖で見せる。1枚の地図に全部のピンを
 * 落とす方法はAPIキーが要るうえ、どのピンがどの場所かは結局読めない。場所ごとに
 * 地図を立てて回る順で矢印でつなぐと、キー無しの埋め込みのままでも「どこを・
 * どの順に」が絵で分かる。矢印自体もその区間の経路検索への入り口になる。
 *
 * 縦(スマホ)と横(PC)の切り替えは trips.css 側。矢印はCSSで回すので、DOMは
 * どちらでも同じ1本の鎖のまま。
 *
 * PCでは1本の列のまま横へ流し、はみ出すぶんは左右のボタン(と普通の横スクロール)
 * で送る。折り返して2段にした時は、段ごとに列の高さが変わるのが目についたため
 * (2026-08-26の指摘)。長い旅行では日にちで絞れば、その日のぶんだけが並ぶ。
 */
export function TripRouteView({
  tripId,
  destination,
  places,
  dayList,
  schedule = [],
  suggestions,
  onAddSuggestions,
  focus,
  onAdd,
  onFirstSaved,
  onEdit,
  onDelete,
  onOpenSchedule,
}: Props) {
  /** 区間ごとの移動手段。1つにまとめて持っていた頃は、どこかで「車」に変えると
   * ほかの地図まで全部つられて変わり、「この区間は電車・ここは車」という見方が
   * できなかった(2026-08-26の指摘)。鍵は区間の始点の場所id(現在地からの区間は
   * "here")。触っていない区間は既定の公共交通機関のまま。 */
  const [legModes, setLegModes] = useState<Record<string, TravelMode>>({});
  /** 「全地点をGoogleマップで開く」に渡す手段。ここだけは区間ではなくルート全体
   * なので、最後に選んだものを使う。 */
  const [lastMode, setLastMode] = useState<TravelMode | null>(null);
  /** 経路を畳んだ区間の、始点の場所id。最初はどの区間も開いている — 「岡山駅 →
   * 新横浜駅」のような区間こそ、ルートを開いた時にいちばん知りたいところなのに、
   * 矢印を押すまで所要時間も移動手段も出てこなかった(2026-08-26の指摘)。
   * 邪魔なときだけ畳めるよう、矢印は開閉ボタンのまま残す。 */
  const [closedLegs, setClosedLegs] = useState<string[]>([]);
  /** いま見ている日。既定は1日目 —「すべて」は本人の指示で外した(2026-09-01)。
   * 日をまたいだ場所を1本の鎖に並べると、その日に回る順として読めないため。
   * 日にちの切り替えを出さない旅行(1日で終わる)だけ、内部的に全件表示のままにする。 */
  const [day, setDay] = useState<string>(ALL_DAYS);
  /** 地図・時間の並びに出さない場所(ルートには残る)。旅行ごとに、この端末の中だけに覚える(src/lib/tripRouteSelection.ts)。 */
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => readHiddenPlaceIds(tripId));
  /** 「地図に出す場所を選ぶ」の一覧を開いているか。 */
  const [pickingPlaces, setPickingPlaces] = useState(false);
  /** 検索は絞り込まず、一致した場所を鎖の中で光らせるだけにする(src/styles/trips.css
   * の.trip-route-card--match) — 間を抜くと区間(誰から誰まで)の意味が崩れるため。 */
  const [query, setQuery] = useState("");
  /** 地図で見るか、時間で見るか。最後に選んだほうを、この端末では覚えておく。 */
  const [view, setView] = useState<RouteViewMode>(readStoredView);
  /** 端末から取れた現在地。鎖の先頭に「現在地 → 最初の場所」を出すのに使う。 */
  const [here, setHere] = useState<string | null>(null);
  const [hereState, setHereState] = useState<"asking" | "ready" | "denied">("asking");

  /** いま見ている日の場所(外してあるものも含む)。 */
  const dayPlaces = places.filter((place) => {
    if (day === ALL_DAYS) return true;
    if (day === NO_DAY) return !place.date;
    return place.date === day;
  });
  /** 地図・時間の並び・「全地点をGoogleマップで開く」に出す場所。外した場所は出さない。 */
  const shown = dayPlaces.filter((place) => !place.id || !hiddenIds.includes(place.id));
  const hiddenInDay = dayPlaces.length - shown.length;

  function setPlaceShown(placeId: string, show: boolean) {
    setHiddenIds((current) =>
      writeHiddenPlaceIds(tripId, toggleHiddenPlace(current, placeId, show), places.flatMap((place) => (place.id ? [place.id] : []))),
    );
  }

  function showAllPlaces() {
    const dayIds = new Set(dayPlaces.flatMap((place) => (place.id ? [place.id] : [])));
    setHiddenIds((current) =>
      writeHiddenPlaceIds(
        tripId,
        current.filter((id) => !dayIds.has(id)),
        places.flatMap((place) => (place.id ? [place.id] : [])),
      ),
    );
  }
  /** いま見ている日の、日程から来た候補。日付なしの場所を見ている時は出さない —
   * 候補はどれも日程の行なので、必ず日付を持っている。 */
  const shownSuggestions = suggestions.filter((suggestion) => {
    if (day === ALL_DAYS) return true;
    if (day === NO_DAY) return false;
    return suggestion.date === day;
  });
  const queries = shown.map((p) => p.address);
  const hasUndated = places.some((place) => !place.date);
  const trimmedQuery = query.trim().toLowerCase();
  const matchedIds = new Set(
    trimmedQuery
      ? shown.filter((p) => p.name.toLowerCase().includes(trimmedQuery) || p.address.toLowerCase().includes(trimmedQuery)).map((p) => p.id)
      : [],
  );
  const noMatch = trimmedQuery.length > 0 && matchedIds.size === 0;
  // 1日だけの旅行に切り替えは要らない。
  const showsDayTabs = dayList.length > 1;

  // 旅行の日付は少し遅れて届くので、届いてから1日目に合わせる。まだどの場所にも
  // 日付が付いていない旅行では「日付なし」から始める — 1日目に寄せると、開いた瞬間に
  // 何も無い画面になり、入れたはずの場所が消えたように見えるため。
  useEffect(() => {
    if (!showsDayTabs || day !== ALL_DAYS) return;
    const hasDated = places.some((place) => place.date);
    setDay(!hasDated && places.length > 0 ? NO_DAY : dayList[0]);
  }, [showsDayTabs, day, dayList, places]);

  // 日程の場所を押して来たら、その場所の日に切り替える(上の「1日目に合わせる」より後に置く —
  // 同じ描画で両方が日を決める時に、こちらを勝たせる)。送るのは描画の後(下の効果)。
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusAt = focus?.at;
  useEffect(() => {
    if (!focus) return;
    const place = places.find((p) => p.id === focus.id);
    if (!place) return;
    if (showsDayTabs) setDay(place.date ?? NO_DAY);
    setQuery("");
    setFocusedId(focus.id);
    // 同じ場所をもう一度押した時にも送り直す(at が変わる)。places の更新では送り直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAt]);
  useEffect(() => {
    if (!focusedId) return;
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-route-place]")).find((node) => node.dataset.routePlace === focusedId);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFocusedId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [focusedId, day, view]);

  // ボタンを押させずに、ルートを開いた時点で現在地を取りにいく。旅行中に開くのは
  // たいてい「いまここからどう行くか」を見たいときで、毎回押させる意味が薄い。
  const hasPlaces = places.length > 0;
  useEffect(() => {
    if (!hasPlaces || here) return;
    if (!navigator.geolocation) {
      setHereState("denied");
      return;
    }
    let alive = true;
    setHereState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!alive) return;
        setHere(coordsQuery(pos.coords.latitude, pos.coords.longitude));
        setHereState("ready");
      },
      () => alive && setHereState("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
    return () => {
      alive = false;
    };
  }, [hasPlaces, here]);

  /**
   * 触っていない区間の手段は、日程でその移動に選んだ手段を基本にする(2026-10-14、要望「ルートでは日程で選択された移動手段を
   * 基本的に示して欲しい」)。区間の始点の場所から出る移動の予定があれば、その手段。無ければ、その日の移動の予定のいちばん多い手段。
   * どちらも決まらなければ、これまでどおり公共交通機関。本人が選び直した区間は、そちらが先(legModes)。
   */
  function scheduleLegMode(place: TripRoutePlace | undefined): TravelMode | undefined {
    if (!place?.date) return undefined;
    return hintFor(transportHints(schedule, place.date), place.address) ?? dayModeFromTransports(schedule, place.date);
  }

  /** 日程との連動(2026-10-14)。日程を直す・足す・消す → ルートも、ルートを直す → 日程も。旅行ごとに、この端末に覚える。 */
  const [linked, setLinked] = useState(() => isRouteLinked(tripId));

  function changeLinked(next: boolean) {
    setLinked(next);
    setRouteLinked(tripId, next);
  }

  /** 日程に住所が入っているのに、場所の名前のままのルートの場所。 */
  const addressReflects = useMemo(() => planAddressReflect(schedule, places), [schedule, places]);
  const [reflecting, setReflecting] = useState(false);

  async function reflectAddresses() {
    setReflecting(true);
    try {
      await Promise.all(addressReflects.map((entry) => db.tripRoutePlaces.update(entry.id, { address: entry.address })));
    } catch (error) {
      console.error("[route] failed to reflect schedule addresses:", error);
    } finally {
      setReflecting(false);
    }
  }

  function legMode(legKey: string): TravelMode {
    const picked = legModes[legKey];
    if (picked) return picked;
    return scheduleLegMode(places.find((place) => place.id === legKey)) ?? DEFAULT_MODE;
  }

  /** 「全地点をGoogleマップで開く」の手段。本人が最後に選んだ手段が先、無ければ、見ている日の日程の手段。 */
  function openAllMode(): TravelMode {
    if (lastMode) return lastMode;
    return (day !== ALL_DAYS && day !== NO_DAY ? dayModeFromTransports(schedule, day) : undefined) ?? DEFAULT_MODE;
  }

  function changeLegMode(legKey: string, next: TravelMode) {
    setLegModes((prev) => ({ ...prev, [legKey]: next }));
    setLastMode(next);
  }

  function changeView(next: RouteViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // 覚えられない環境でも、見方の切り替え自体は動く。
    }
  }

  function toggleLeg(id: string | undefined) {
    if (!id) return;
    setClosedLegs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function swap(a: TripRoutePlace, b: TripRoutePlace) {
    if (!a.id || !b.id) return;
    await Promise.all([
      db.tripRoutePlaces.update(a.id, { sortOrder: b.sortOrder }),
      db.tripRoutePlaces.update(b.id, { sortOrder: a.sortOrder }),
    ]);
  }

  return (
    <div className="trip-route">
      {/* 1件も無いうちは「地図で開く」を出さない — 開いても行き先の地図が出るだけで、
          この画面でやることは「1件目を入れる」しかない。代わりに入力欄をそのまま出す。 */}
      {shown.length > 0 && (
        <div className="trip-route__head">
          <a
            className="trip-route__open"
            href={buildRouteSearchUrl(queries, openAllMode())}
            target="_blank"
            rel="noreferrer"
          >
            <Map size={16} />
            {shown.length > 1 ? "全地点をGoogleマップで開く" : "Googleマップで開く"}
            <ExternalLink size={14} />
          </a>
          {places.length > 1 && view === "map" && (
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="行きたい場所を検索(鎖の中で光ります)"
                className="field-shell w-full !pl-9"
              />
              {noMatch && <p className="mt-1.5 text-xs text-slate-400">一致する場所が見つかりません(日にちの絞り込みも確認してください)。</p>}
            </div>
          )}
        </div>
      )}

      {places.length === 0 ? (
        <div className="trip-route-start">
          <div className="trip-route-start__lead">
            <span aria-hidden="true"><Map size={20} /></span>
            <h2>行きたい場所を追加</h2>
            <p>{destination}で行きたい場所を、住所か施設名で入れてください。入れた場所の地図がここに並びます。</p>
          </div>
          <TripRoutePicks suggestions={suggestions} onAdd={onAddSuggestions} />
          <TripRouteForm tripId={tripId} nextSortOrder={1} dayList={dayList} inline onSaved={onFirstSaved} onCancel={onFirstSaved} />
        </div>
      ) : (
        <>
          {/* 見方の切り替え。ボタンは1つずつ分けて並べる(日にちのチップと同じ形)。 */}
          <div className="trip-route__days" role="group" aria-label="ルートの見方">
            <button
              type="button"
              className={`trip-route__day${view === "map" ? " is-active" : ""}`}
              aria-pressed={view === "map"}
              onClick={() => changeView("map")}
            >
              <Map size={14} />
              地図で見る
            </button>
            <button
              type="button"
              className={`trip-route__day${view === "time" ? " is-active" : ""}`}
              aria-pressed={view === "time"}
              onClick={() => changeView("time")}
            >
              <Clock size={14} />
              時間で見る
            </button>
          </div>

          {/* 日にちの切り替え。長い旅行ほど列が伸びるので、その日に回るぶんだけに
              絞れるようにする。日付を決めていない場所は「日付なし」に集まる。 */}
          {showsDayTabs && (
            <div className="trip-route__days" role="group" aria-label="日にちで絞る">
              {dayList.map((date, i) => {
                const count = places.filter((place) => place.date === date).length;
                return (
                  <button
                    key={date}
                    type="button"
                    className={`trip-route__day${day === date ? " is-active" : ""}`}
                    aria-pressed={day === date}
                    onClick={() => setDay(date)}
                  >
                    {i + 1}日目 {formatShortDate(date)}
                    <small>{count}</small>
                  </button>
                );
              })}
              {hasUndated && (
                <button
                  type="button"
                  className={`trip-route__day${day === NO_DAY ? " is-active" : ""}`}
                  aria-pressed={day === NO_DAY}
                  onClick={() => setDay(NO_DAY)}
                >
                  日付なし<small>{places.filter((place) => !place.date).length}</small>
                </button>
              )}
            </div>
          )}

          <label className="trip-route-link">
            <input type="checkbox" checked={linked} onChange={(e) => changeLinked(e.target.checked)} />
            <span>
              日程と連動する
              <small>日程を直す・足す・消すとルートも、ルートを直すと日程も、一緒に変わります。</small>
            </span>
          </label>

          {addressReflects.length > 0 && (
            <div className="trip-route-reflect" role="status">
              <p>
                日程に住所が入っている場所が<b>{addressReflects.length}</b>件あります。ルートの地図に、その住所を使うと、同じ名前の別の場所に置かれません。
              </p>
              <button type="button" disabled={reflecting} onClick={() => void reflectAddresses()}>
                {reflecting ? "反映しています…" : "日程の住所を反映"}
              </button>
            </div>
          )}

          <TripRoutePicks suggestions={shownSuggestions} onAdd={onAddSuggestions} />

          {/* 見たい場所だけを地図に出す。外した場所はルートに残り、ここでいつでも戻せる。 */}
          {dayPlaces.length > 1 && (
            <section className="trip-route-show" aria-label="地図に出す場所">
              <button
                type="button"
                className="trip-route-show__toggle"
                aria-expanded={pickingPlaces}
                onClick={() => setPickingPlaces((open) => !open)}
              >
                地図に出す場所を選ぶ
                <small>
                  {shown.length}/{dayPlaces.length}件を表示中
                </small>
              </button>
              {pickingPlaces && (
                <>
                  <ul className="trip-route-show__list">
                    {dayPlaces.map((place) => (
                      <li key={place.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={!place.id || !hiddenIds.includes(place.id)}
                            onChange={(e) => place.id && setPlaceShown(place.id, e.target.checked)}
                            aria-label={`${place.name}を地図に出す`}
                          />
                          <span>{place.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {hiddenInDay > 0 && (
                    <button type="button" className="trip-route-picks__all" onClick={showAllPlaces}>
                      すべて表示する
                    </button>
                  )}
                </>
              )}
            </section>
          )}

          {shown.length === 0 ? (
            dayPlaces.length > 0 ? (
              <div className="trip-route__day-empty">
                <p>地図に出す場所が選ばれていません。上の「地図に出す場所を選ぶ」で選ぶか、すべて表示に戻せます。</p>
                <button type="button" onClick={showAllPlaces}>
                  すべて表示する
                </button>
              </div>
            ) : (
              <div className="trip-route__day-empty">
                <p>この日に回る場所はまだ入っていません。</p>
                <button type="button" onClick={onAdd}>
                  <Plus size={16} />
                  場所を追加
                </button>
              </div>
            )
          ) : view === "time" ? (
            <div className="trip-route__time">
              <TripRouteTimeline
                stops={buildRouteTimeline(shown, schedule)}
                modeOf={(placeId) => legMode(placeId)}
                focusedId={focusedId}
                onOpenSchedule={onOpenSchedule}
              />
              <p className="trip-route__time-note">
                時刻は日程に入れた時刻です。変えるときは日程を直してください。移動時間は、地図の画面で選んだ移動手段のものです。
              </p>
              <button type="button" className="trip-route-add" onClick={onAdd}>
                <span><Plus size={18} /></span>
                場所を追加
              </button>
            </div>
          ) : (
            <ol className="trip-route__chain">
              {/* 鎖の先頭は「いまいる場所」。ここから最初の目的地までをそのまま出す。 */}
              <li className="trip-route__node trip-route__node--here">
                <article className="trip-route-card trip-route-card--here">
                  <header className="trip-route-card__head">
                    <span className="trip-route-card__index is-here" aria-hidden="true">
                      <LocateFixed size={14} />
                    </span>
                    <h3>現在地 → {shown[0].name}</h3>
                  </header>

                  {here ? (
                    <TripLegRoute
                      origin={here}
                      originLabel="現在地"
                      destination={shown[0].address}
                      destinationLabel={shown[0].name}
                      mode={legMode(HERE_LEG)}
                      onModeChange={(next) => changeLegMode(HERE_LEG, next)}
                      mapClassName="trip-route-card__map"
                      buildOpenUrl={(to, mode) => buildFromHereSearchUrl(to, mode)}
                      openLabel="現在地からの案内をGoogleマップで開く"
                      mapFirst
                    />
                  ) : (
                    <>
                      <p className="trip-route-card__state">
                        {hereState === "asking"
                          ? "現在地を確認しています…"
                          : "現在地を取得できませんでした。下のリンクなら、Googleマップ側が現在地から案内します。"}
                      </p>
                      <a
                        className="trip-route-leg__open"
                        href={buildFromHereSearchUrl(shown[0].address, legMode(HERE_LEG))}
                        target="_blank"
                        rel="noreferrer"
                      >
                        現在地からの案内をGoogleマップで開く
                        <ExternalLink size={13} />
                      </a>
                    </>
                  )}
                </article>
              </li>

              {/* ここは経路がもう地図に出ているので、矢印は向きを示すだけにする。 */}
              <li className="trip-route__node trip-route__node--arrow" aria-hidden="true">
                <div className="trip-route-arrow trip-route-arrow--static">
                  <span className="trip-route-arrow__mark"><ArrowDown size={17} /></span>
                </div>
              </li>

              {shown.map((place, i) => {
                const next = shown[i + 1];
                const legOpen = !!place.id && !closedLegs.includes(place.id);
                return (
                  <Fragment key={place.id}>
                    <li className="trip-route__node">
                      <article
                        data-route-place={place.id}
                        className={`trip-route-card trip-route-card--place${
                          place.id && (matchedIds.has(place.id) || place.id === focusedId) ? " trip-route-card--match" : ""
                        }`}
                      >
                        <header className="trip-route-card__head">
                          <button
                            type="button"
                            onClick={() => place.id && db.tripRoutePlaces.update(place.id, { visited: !place.visited })}
                            aria-label={place.visited ? "「行った」を取り消す" : "行ったことにする"}
                            aria-pressed={place.visited}
                            className={`trip-route-card__index${place.visited ? " is-visited" : ""}`}
                          >
                            {place.visited ? <Check size={14} strokeWidth={3} /> : i + 1}
                          </button>
                          <h3 title={place.name}>{place.name}</h3>
                          <div className="trip-route-card__tools">
                            <button
                              type="button"
                              onClick={() => i > 0 && swap(place, shown[i - 1])}
                              disabled={i === 0}
                              aria-label="順番を前へ"
                            >
                              <MoveUp size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => next && swap(place, next)}
                              disabled={!next}
                              aria-label="順番を後へ"
                            >
                              <MoveDown size={15} />
                            </button>
                            {/* 元になった日程を開く。日程にその場所(同じ日・同じ場所)が見つかった時だけ。 */}
                            {onOpenSchedule && (() => {
                              const source = findSourceSchedule(place, schedule);
                              return source ? (
                                <button type="button" onClick={() => onOpenSchedule(source)} aria-label={`${place.name}の元の予定を開く`}>
                                  <CalendarDays size={15} />
                                </button>
                              ) : null;
                            })()}
                            <button type="button" onClick={() => onEdit(place)} aria-label={`${place.name}を編集`}>
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              // 確認は聞かない。消したあと5秒間「元に戻す」が出る(UI/UX 調査メモ 第4弾 A-2。
                              // お知らせは TripDetailPage が出す)。
                              onClick={() => {
                                if (place.id) onDelete(place.id);
                              }}
                              aria-label="削除"
                              className="trip-route-card__remove"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </header>

                        <div className="trip-route-card__map">
                          <iframe
                            title={`${place.name}の地図`}
                            src={buildMapEmbedUrl(place.address)}
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>

                        <div className="trip-route-card__info">
                          <p className="trip-route-card__address" title={place.address}>{place.address}</p>
                          {/* いちばん近い駅から徒歩何分か。押すと駅からの道が地図で開く
                              (src/components/trips/TripPlaceStation.tsx)。 */}
                          <TripPlaceStation placeName={place.name} address={place.address} />
                          {place.memo && <p className="trip-route-card__memo">{place.memo}</p>}
                        </div>
                      </article>
                    </li>

                    {next && (
                      <li className="trip-route__node trip-route__node--leg">
                        <div className="trip-route-leg">
                          <button
                            type="button"
                            className="trip-route-arrow"
                            onClick={() => toggleLeg(place.id)}
                            aria-expanded={legOpen}
                            aria-label={`${place.name}から${next.name}までの経路を${legOpen ? "閉じる" : "見る"}`}
                          >
                            <span className="trip-route-arrow__mark"><ArrowDown size={17} /></span>
                            <small>経路</small>
                          </button>

                          {legOpen && (
                            <div className="trip-route-leg__panel">
                              <p className="trip-route-leg__title">
                                {place.name} → {next.name}
                              </p>
                              <TripLegRoute
                                origin={place.address}
                                originLabel={place.name}
                                destination={next.address}
                                destinationLabel={next.name}
                                mode={legMode(place.id ?? "")}
                                onModeChange={(m) => changeLegMode(place.id ?? "", m)}
                                mapClassName="trip-route-leg__map"
                                buildOpenUrl={(to, mode) => buildLegSearchUrl(place.address, to, mode)}
                                openLabel="乗換と所要時間をGoogleマップで見る"
                              />
                            </div>
                          )}
                        </div>
                      </li>
                    )}
                  </Fragment>
                );
              })}

              <li className="trip-route__node trip-route__node--add">
                <button type="button" className="trip-route-add" onClick={onAdd}>
                  <span><Plus size={18} /></span>
                  場所を追加
                </button>
              </li>
            </ol>
          )}
        </>
      )}
    </div>
  );
}
