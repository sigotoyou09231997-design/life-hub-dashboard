import { ArrowDown, Check, ExternalLink, Map, MoveLeft, MoveRight, Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "../../db/schema";
import type { TripRoutePlace } from "../../types";
import { buildMapEmbedUrl, buildLegSearchUrl, buildRouteSearchUrl } from "../../lib/googleMaps";
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
export function TripRouteView({ tripId, destination, places, onAdd, onFirstSaved, onEdit, onDelete }: Props) {
  const queries = places.map((p) => p.address);

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
        <a
          className="trip-route__open"
          href={buildRouteSearchUrl(queries)}
          target="_blank"
          rel="noreferrer"
        >
          <Map size={16} />
          {places.length > 1 ? "全地点をGoogleマップで開く" : "Googleマップで開く"}
          <ExternalLink size={14} />
        </a>
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

                {next && (
                  <a
                    className="trip-route-arrow"
                    href={buildLegSearchUrl(place.address, next.address)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${place.name}から${next.name}までの経路をGoogleマップで見る`}
                  >
                    <span className="trip-route-arrow__mark"><ArrowDown size={17} /></span>
                    <small>経路</small>
                  </a>
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
