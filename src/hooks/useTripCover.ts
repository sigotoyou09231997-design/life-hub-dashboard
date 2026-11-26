import { useEffect, useState } from "react";
import { resolveTripCover, tripCoverImage } from "../lib/tripCovers";
import { IS_DEMO } from "../lib/demoMode";

export interface TripCoverResult {
  /** 背景に敷くURL。同梱の写真から始まり、その土地の写真が用意でき次第そちらに変わる。 */
  url: string;
  /** 撮影者のクレジット。Googleの写真の時だけ入る。 */
  attribution?: string;
}

/**
 * 旅行の表紙写真。
 *
 * まず同梱の写真（旅行ごとに決まる1枚）を返し、裏でその土地の実際の写真を探して、
 * 見つかったら差し替える。差し替える前に画像を読み込み切ってから入れ替えるので、
 * 表紙が一瞬空白になることはない。見つからなければ同梱の写真のまま。
 */
export function useTripCover(name: string, destination: string): TripCoverResult {
  // デモ(/demo)では表紙の写真を出さない(2026-11-27)。同梱の写真は建物・海などで行き先と合わず、「秋の京都」が
  // コンクリートの部屋に見えていた。その土地の写真は地図のキーが無いと取れないので、デモだけ写真なしの形にする。
  // url が空の時は、各画面が写真なしの見た目にする。本人の画面は今までどおり。
  if (IS_DEMO) return { url: "" };
  return useRealTripCover(name, destination);
}

function useRealTripCover(name: string, destination: string): TripCoverResult {
  const fallback = tripCoverImage(destination || name);
  const [cover, setCover] = useState<TripCoverResult>({ url: fallback });

  useEffect(() => {
    let alive = true;
    setCover({ url: tripCoverImage(destination || name) });
    void resolveTripCover(name, destination).then((resolved) => {
      if (!alive || !resolved) return;
      const image = new Image();
      image.onload = () => {
        if (alive) setCover(resolved);
      };
      image.src = resolved.url;
    });
    return () => {
      alive = false;
    };
  }, [name, destination]);

  return cover;
}
