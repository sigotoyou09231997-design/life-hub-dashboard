import { useState } from "react";
import { ArrowDown, Check, ExternalLink, Footprints, LocateFixed, Map, MoveLeft, MoveRight, Pencil, Plus, Train, Car, Trash2 } from "lucide-react";
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
 */
/** 区間の移動手段。旅行の移動は電車が既定 — 空港や駅を経由する線が出るのはこれ。 */
const TRAVEL_MODES: { value: TravelMode; label: string; icon: typeof Train }[] = [
  { value: "transit", label: "電車", icon: Train },
  { value: "driving", label: "車", icon: Car },
  { value: "walking", label: "徒歩", icon: Footprints },
];

export function TripRouteView({ tripId, destination, places, onAdd, onFirstSaved, onEdit, onDelete }: Props) {
  const queries = places.map((p) => p.address);
  const [mode, setMode] = useState<TravelMode>("transit");
  /** 経路を開いている区間の、始点の場所id。同時に開くのは1区間だけ。 */
  const [openLeg, setOpenLeg] = useState<string | null>(null);
  /** 「現在地から」を開いている場所id。 */
  const [fromHere, setFromHere] = useState<string | null>(null);
  /** 端末から取れた現在地。一度取れたら他の場所にも使い回す。 */
  const [here, setHere] = useState<string | null>(null);
  const [hereState, setHereState] = useState<"idle" | "asking" | "denied">("idle");

  function showFromHere(placeId: string) {
    if (fromHere === placeId) {
      setFromHere(null);
      return;
    }
    setFromHere(placeId);
    if (here || hereState === "asking") return;
    if (!navigator.geolocation) {
      setHereState("denied");
      return;
    }
    setHereState("asking");
    // 現在地はブラウザの標準機能から取る(APIキーは要らない)。断られたら地図は
    // 出せないので、Googleマップ側に現在地を入れてもらうリンクだけを残す。
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHere(coordsQuery(pos.coords.latitude, pos.coords.longitude));
        setHereState("idle");
      },
      () => setHereState("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
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
          {places.length > 1 && (
            <div className="trip-route__modes" role="group" aria-label="区間の移動手段">
              {TRAVEL_MODES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  aria-pressed={mode === value}
                  className={mode === value ? "is-active" : undefined}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          )}
          <a
            className="trip-route__open"
            href={buildRouteSearchUrl(queries, mode)}
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
          {places.map((place, i) => {
            const next = places[i + 1];
            return (
              <li key={place.id} className="trip-route__node">
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
                      <button
                        type="button"
                        onClick={() => place.id && showFromHere(place.id)}
                        aria-expanded={fromHere === place.id}
                        aria-label={`現在地から${place.name}までの経路`}
                        className={fromHere === place.id ? "is-active" : undefined}
                      >
                        <LocateFixed size={15} />
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

                  {fromHere === place.id && (
                    <div className="trip-route-here">
                      <p className="trip-route-here__title">現在地 → {place.name}</p>
                      {here ? (
                        <div className="trip-route-here__map">
                          <iframe
                            key={`${here}-${place.id}-${mode}`}
                            title={`現在地から${place.name}までの経路`}
                            src={buildLegEmbedUrl(here, place.address, mode)}
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>
                      ) : (
                        <p className="trip-route-here__state">
                          {hereState === "asking"
                            ? "現在地を確認しています…"
                            : "現在地を取得できませんでした。下のリンクなら、Googleマップ側が現在地から案内します。"}
                        </p>
                      )}
                      <a
                        className="trip-route-leg__open"
                        href={buildFromHereSearchUrl(place.address, mode)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        現在地からの案内をGoogleマップで開く
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  )}
                </article>

                {next && (
                  <div className="trip-route-leg">
                    <button
                      type="button"
                      className="trip-route-arrow"
                      onClick={() => setOpenLeg(openLeg === place.id ? null : (place.id ?? null))}
                      aria-expanded={openLeg === place.id}
                      aria-label={`${place.name}から${next.name}までの経路を${openLeg === place.id ? "閉じる" : "見る"}`}
                    >
                      <span className="trip-route-arrow__mark"><ArrowDown size={17} /></span>
                      <small>経路</small>
                    </button>

                    {openLeg === place.id && (
                      <div className="trip-route-leg__panel">
                        <p className="trip-route-leg__title">
                          {place.name} → {next.name}
                        </p>
                        <div className="trip-route-leg__map">
                          <iframe
                            key={`${place.id}-${mode}`}
                            title={`${place.name}から${next.name}までの経路`}
                            src={buildLegEmbedUrl(place.address, next.address, mode)}
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>
                        <a
                          className="trip-route-leg__open"
                          href={buildLegSearchUrl(place.address, next.address, mode)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          乗換と所要時間をGoogleマップで見る
                          <ExternalLink size={13} />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </li>
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
