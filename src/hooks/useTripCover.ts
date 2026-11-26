import { useEffect, useState } from "react";
import { resolveTripCover } from "../lib/tripCovers";
import { tripCoverPlace, tripCoverTone, type TripCoverTone } from "../lib/tripCoverTone";
import { IS_DEMO } from "../lib/demoMode";

export interface TripCoverResult {
  /** その土地の写真の URL。取れていない時は空(各画面は、下の色の面と地名の表紙を出す)。 */
  url: string;
  /** 撮影者のクレジット。Googleの写真の時だけ入る。 */
  attribution?: string;
  /** 写真が無い時の表紙の色(行き先ごと。src/lib/tripCoverTone.ts)。 */
  tone: TripCoverTone;
  /** 写真が無い時の表紙に大きく出す地名。 */
  place: string;
}

/**
 * 旅行の表紙。
 *
 * 2026-11-27(見せる品質 その3)から: その土地の写真が取れた時だけ写真を出し、取れていない時は
 * 「行き先ごとの色の面＋大きな地名」にする。前は取れるまで同梱の写真(建物・海など)を出していて、
 * 行き先と合わなかった。デモ(/demo)では写真を取りに行かない(サーバーの AI と地図に費用がかかるため)。
 */
export function useTripCover(name: string, destination: string): TripCoverResult {
  const tone = tripCoverTone(destination || name);
  const place = tripCoverPlace(name, destination);
  const [photo, setPhoto] = useState<{ url: string; attribution?: string } | null>(null);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    setPhoto(null);
    void resolveTripCover(name, destination).then((resolved) => {
      if (!alive || !resolved) return;
      const image = new Image();
      image.onload = () => {
        if (alive) setPhoto(resolved);
      };
      image.src = resolved.url;
    });
    return () => {
      alive = false;
    };
  }, [name, destination]);

  return { url: photo?.url ?? "", attribution: photo?.attribution, tone, place };
}
