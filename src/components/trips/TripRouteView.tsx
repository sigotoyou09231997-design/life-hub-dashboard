import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LocateFixed,
  Map,
  MoveLeft,
  MoveRight,
  Pencil,
  Plus,
  CalendarPlus,
  Search,
  Trash2,
} from "lucide-react";
import { db } from "../../db/schema";
import type { TripRoutePlace } from "../../types";
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
import { TripPlaceStation } from "./TripPlaceStation";
import { useConfirm } from "../ui/ConfirmProvider";

interface Props {
  tripId: string;
  destination: string;
  /** 並べ替え済み(sortOrder昇順)で渡すこと。 */
  places: TripRoutePlace[];
  /** 旅行の全日程(YYYY-MM-DD)。日にちの切り替えに使う。 */
  dayList: string[];
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
}

/** 現在地から1つ目の場所までの区間につける鍵。場所idと混ざらない名前にしてある。 */
const HERE_LEG = "here";
const DEFAULT_MODE: TravelMode = "transit";
/** 日にちの切り替えで「全部見る」と「日付を決めていない場所」を表す値。 */
const ALL_DAYS = "all";
const NO_DAY = "none";

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
  if (suggestions.length === 0) return null;

  return (
    <section className="trip-route-picks">
      <header className="trip-route-picks__head">
        <span aria-hidden="true"><CalendarPlus size={16} /></span>
        <h3>日程に入っている場所</h3>
        <b>{suggestions.length}</b>
      </header>
      <p className="trip-route-picks__lead">
        日程にはあるのに、ルートにはまだ入っていない場所です。入れると地図と経路が並びます。
      </p>
      <ul className="trip-route-picks__list">
        {suggestions.map((suggestion) => (
          <li key={suggestion.scheduleId}>
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
      {suggestions.length > 1 && (
        <button type="button" className="trip-route-picks__all" onClick={() => onAdd(suggestions)}>
          すべてルートに入れる
        </button>
      )}
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
  suggestions,
  onAddSuggestions,
  onAdd,
  onFirstSaved,
  onEdit,
  onDelete,
}: Props) {
  const confirm = useConfirm();
  /** 区間ごとの移動手段。1つにまとめて持っていた頃は、どこかで「車」に変えると
   * ほかの地図まで全部つられて変わり、「この区間は電車・ここは車」という見方が
   * できなかった(2026-08-26の指摘)。鍵は区間の始点の場所id(現在地からの区間は
   * "here")。触っていない区間は既定の公共交通機関のまま。 */
  const [legModes, setLegModes] = useState<Record<string, TravelMode>>({});
  /** 「全地点をGoogleマップで開く」に渡す手段。ここだけは区間ではなくルート全体
   * なので、最後に選んだものを使う。 */
  const [lastMode, setLastMode] = useState<TravelMode>(DEFAULT_MODE);
  /** 経路を畳んだ区間の、始点の場所id。最初はどの区間も開いている — 「岡山駅 →
   * 新横浜駅」のような区間こそ、ルートを開いた時にいちばん知りたいところなのに、
   * 矢印を押すまで所要時間も移動手段も出てこなかった(2026-08-26の指摘)。
   * 邪魔なときだけ畳めるよう、矢印は開閉ボタンのまま残す。 */
  const [closedLegs, setClosedLegs] = useState<string[]>([]);
  /** いま見ている日。既定は1日目 —「すべて」は本人の指示で外した(2026-09-01)。
   * 日をまたいだ場所を1本の鎖に並べると、その日に回る順として読めないため。
   * 日にちの切り替えを出さない旅行(1日で終わる)だけ、内部的に全件表示のままにする。 */
  const [day, setDay] = useState<string>(ALL_DAYS);
  /** 検索は絞り込まず、一致した場所を鎖の中で光らせるだけにする(src/styles/trips.css
   * の.trip-route-card--match) — 間を抜くと区間(誰から誰まで)の意味が崩れるため。 */
  const [query, setQuery] = useState("");
  /** 端末から取れた現在地。鎖の先頭に「現在地 → 最初の場所」を出すのに使う。 */
  const [here, setHere] = useState<string | null>(null);
  const [hereState, setHereState] = useState<"asking" | "ready" | "denied">("asking");

  const shown = places.filter((place) => {
    if (day === ALL_DAYS) return true;
    if (day === NO_DAY) return !place.date;
    return place.date === day;
  });
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

  /* --- 横スクロールの送りボタン ------------------------------------------
     PCでは列が画面より長くなる。スクロールバーは普段隠れていて、続きがあること
     自体に気づけなかったので、左右に送りボタンを出す(2026-08-26の指摘)。
     押せるかどうかは、いまの位置から測って決める。 */
  const chainRef = useRef<HTMLOListElement>(null);
  const [rail, setRail] = useState({ prev: false, next: false });

  const updateRail = useCallback(() => {
    const el = chainRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setRail({ prev: el.scrollLeft > 8, next: el.scrollLeft < max - 8 });
  }, []);

  useEffect(() => {
    updateRail();
    window.addEventListener("resize", updateRail);
    return () => window.removeEventListener("resize", updateRail);
    // 並びが変わると長さも変わる(日にちの切り替え・区間の開け閉め・場所の増減)。
  }, [updateRail, shown.length, closedLegs.length, day]);

  function scrollChain(direction: 1 | -1) {
    const el = chainRef.current;
    if (!el?.scrollBy) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  }

  function legMode(legKey: string): TravelMode {
    return legModes[legKey] ?? DEFAULT_MODE;
  }

  function changeLegMode(legKey: string, next: TravelMode) {
    setLegModes((prev) => ({ ...prev, [legKey]: next }));
    setLastMode(next);
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
            href={buildRouteSearchUrl(queries, lastMode)}
            target="_blank"
            rel="noreferrer"
          >
            <Map size={16} />
            {shown.length > 1 ? "全地点をGoogleマップで開く" : "Googleマップで開く"}
            <ExternalLink size={14} />
          </a>
          {places.length > 1 && (
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

          <TripRoutePicks suggestions={shownSuggestions} onAdd={onAddSuggestions} />

          {shown.length === 0 ? (
            <div className="trip-route__day-empty">
              <p>この日に回る場所はまだ入っていません。</p>
              <button type="button" onClick={onAdd}>
                <Plus size={16} />
                場所を追加
              </button>
            </div>
          ) : (
            <div className="trip-route__rail">
              <button
                type="button"
                className="trip-route__scroll trip-route__scroll--prev"
                onClick={() => scrollChain(-1)}
                disabled={!rail.prev}
                aria-label="前の場所へ"
              >
                <ChevronLeft size={20} />
              </button>

              <ol className="trip-route__chain" ref={chainRef} onScroll={updateRail}>
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
                        <article className={`trip-route-card${place.id && matchedIds.has(place.id) ? " trip-route-card--match" : ""}`}>
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
                                <MoveLeft size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => next && swap(place, next)}
                                disabled={!next}
                                aria-label="順番を後へ"
                              >
                                <MoveRight size={15} />
                              </button>
                              <button type="button" onClick={() => onEdit(place)} aria-label={`${place.name}を編集`}>
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: `「${place.name}」をルートから削除しますか?`,
                                  });
                                  if (place.id && ok) onDelete(place.id);
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

                          <p className="trip-route-card__address" title={place.address}>{place.address}</p>
                          {/* いちばん近い駅から徒歩何分か。押すと駅からの道が地図で開く
                              (src/components/trips/TripPlaceStation.tsx)。 */}
                          <TripPlaceStation placeName={place.name} address={place.address} />
                          {place.memo && <p className="trip-route-card__memo">{place.memo}</p>}
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

              <button
                type="button"
                className="trip-route__scroll trip-route__scroll--next"
                onClick={() => scrollChain(1)}
                disabled={!rail.next}
                aria-label="次の場所へ"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
