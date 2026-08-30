import { useEffect, useState } from "react";
import { resolveTripCover, tripCoverImage } from "../lib/tripCovers";

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
