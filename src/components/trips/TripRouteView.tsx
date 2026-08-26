import { Fragment, useEffect, useState } from "react";
import { ArrowDown, Check, ExternalLink, LocateFixed, Map, MoveLeft, MoveRight, Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "../../db/schema";
import type { TripRoutePlace } from "../../types";
import {
  buildMapEmbedUrl,
  buildLegEmbedUrl,
  buildLegSearchUrl,
  buildRouteSearchUrl,
  buildFromHereSearchUrl,
  coordsQuery,
} from "../../lib/googleMaps";
import type { TravelMode } from "../../lib/googleMaps";
import { TripRouteForm } from "./TripRouteForm";
import { TripLegModes } from "./TripLegModes";

/** 現在地から1つ目の場所までの区間につける鍵。場所idと混ざらない名前にしてある。 */
const HERE_LEG = "here";
const DEFAULT_MODE: TravelMode = "transit";

interface Props {
  tripId: string;
  destination: string;
  /** 並べ替え済み(sortOrder昇順)で渡すこと。 */
  places: TripRoutePlace[];
  onAdd: () => void;
  /** 1件目をこの画面の中で保存し終えたとき(空のとき出すフォーム用)。 */
  onFirstSaved: () => void;
  onEdit: (place: TripRoutePlace) => void;
  onDelete: (id: string) => void;
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
 * カード・矢印・区間の経路は、それぞれを鎖の1コマ(li)として並べる。PCでは行の
 * 幅で折り返すので、コマの途中で切れないようにこの粒度にしてある — ひとかたまり
 * にしていた頃は、右端のカードが画面の外で半分に切れていた(2026-08-26の指摘)。
 */
export function TripRouteView({ tripId, destination, places, onAdd, onFirstSaved, onEdit, onDelete }: Props) {
  const queries = places.map((p) => p.address);
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
  /** 端末から取れた現在地。鎖の先頭に「現在地 → 最初の場所」を出すのに使う。 */
  const [here, setHere] = useState<string | null>(null);
  const [hereState, setHereState] = useState<"asking" | "ready" | "denied">("asking");

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

  function toggleLeg(id: string | undefined) {
    if (!id) return;
    setClosedLegs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function legMode(legKey: string): TravelMode {
    return legModes[legKey] ?? DEFAULT_MODE;
  }

  function changeLegMode(legKey: string, next: TravelMode) {
    setLegModes((prev) => ({ ...prev, [legKey]: next }));
    setLastMode(next);
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
      {places.length > 0 && (
        <div className="trip-route__head">
          <a
            className="trip-route__open"
            href={buildRouteSearchUrl(queries, lastMode)}
            target="_blank"
            rel="noreferrer"
          >
            <Map size={16} />
            {places.length > 1 ? "全地点をGoogleマップで開く" : "Googleマップで開く"}
            <ExternalLink size={14} />
          </a>
        </div>
      )}

      {places.length === 0 ? (
        <div className="trip-route-start">
          <div className="trip-route-start__lead">
            <span aria-hidden="true"><Map size={20} /></span>
            <h2>行きたい場所を追加</h2>
            <p>{destination}で行きたい場所を、住所か施設名で入れてください。入れた場所の地図がここに並びます。</p>
          </div>
          <TripRouteForm tripId={tripId} nextSortOrder={1} inline onSaved={onFirstSaved} onCancel={onFirstSaved} />
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
                <h3>現在地 → {places[0].name}</h3>
              </header>

              {here ? (
                <div className="trip-route-card__map">
                  <iframe
                    key={`${here}-${places[0].id}-${legMode(HERE_LEG)}`}
                    title={`現在地から${places[0].name}までの経路`}
                    src={buildLegEmbedUrl(here, places[0].address, legMode(HERE_LEG))}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              ) : (
                <p className="trip-route-card__state">
                  {hereState === "asking"
                    ? "現在地を確認しています…"
                    : "現在地を取得できませんでした。下のリンクなら、Googleマップ側が現在地から案内します。"}
                </p>
              )}

              {here && (
                <TripLegModes
                  origin={here}
                  destination={places[0].address}
                  mode={legMode(HERE_LEG)}
                  onModeChange={(next) => changeLegMode(HERE_LEG, next)}
                />
              )}

              <a
                className="trip-route-leg__open"
                href={buildFromHereSearchUrl(places[0].address, legMode(HERE_LEG))}
                target="_blank"
                rel="noreferrer"
              >
                現在地からの案内をGoogleマップで開く
                <ExternalLink size={13} />
              </a>
            </article>
          </li>

          {/* ここは経路がもう地図に出ているので、矢印は向きを示すだけにする。 */}
          <li className="trip-route__node trip-route__node--arrow" aria-hidden="true">
            <div className="trip-route-arrow trip-route-arrow--static">
              <span className="trip-route-arrow__mark"><ArrowDown size={17} /></span>
            </div>
          </li>

          {places.map((place, i) => {
            const next = places[i + 1];
            const legOpen = !!place.id && !closedLegs.includes(place.id);
            return (
              <Fragment key={place.id}>
              <li className="trip-route__node">
                <article className="trip-route-card">
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
                        onClick={() => i > 0 && swap(place, places[i - 1])}
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
                        onClick={() => {
                          if (place.id && confirm(`「${place.name}」をルートから削除しますか?`)) onDelete(place.id);
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
                        <TripLegModes
                          origin={place.address}
                          destination={next.address}
                          mode={legMode(place.id ?? "")}
                          onModeChange={(m) => changeLegMode(place.id ?? "", m)}
                        />
                        <div className="trip-route-leg__map">
                          <iframe
                            key={`${place.id}-${legMode(place.id ?? "")}`}
                            title={`${place.name}から${next.name}までの経路`}
                            src={buildLegEmbedUrl(place.address, next.address, legMode(place.id ?? ""))}
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>
                        <a
                          className="trip-route-leg__open"
                          href={buildLegSearchUrl(place.address, next.address, legMode(place.id ?? ""))}
                          target="_blank"
                          rel="noreferrer"
                        >
                          乗換と所要時間をGoogleマップで見る
                          <ExternalLink size={13} />
                        </a>
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
    </div>
  );
}
