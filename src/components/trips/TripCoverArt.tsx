import type { CSSProperties } from "react";
import { Leaf } from "lucide-react";
import type { TripCoverResult } from "../../hooks/useTripCover";

interface Props {
  cover: TripCoverResult;
  /** 面の置き場所のクラス(各画面の写真の枠と同じクラス。大きさ・角丸はそちらで決まる)。 */
  className: string;
  /** hero = 旅行の一覧・詳細の大きな表紙 ／ thumb = ホーム・終わった旅行の小さな四角。 */
  size?: "hero" | "thumb";
  /** 地名の下の1行(日付・あと何日など)。hero の時だけ出す。 */
  note?: string;
}

/**
 * 写真が無い旅行の表紙(2026-11-27、見せる品質 その3)。行き先ごとの淡い色の面に、大きな地名と、
 * LIFE HUB のロゴの葉を薄く置く。写真がある旅行は、各画面が今までどおり写真を出す。
 * 読み上げでは何も言わない(地名・日付は、カードの本文に同じことが書いてある)。
 */
export function TripCoverArt({ cover, className, size = "hero", note }: Props) {
  const style = { "--cover-bg": cover.tone.bg, "--cover-ink": cover.tone.ink } as CSSProperties;
  return (
    <div className={`${className} trip-cover-art trip-cover-art--${size}`} style={style} aria-hidden="true">
      <Leaf className="trip-cover-art__leaf" strokeWidth={1.25} />
      <span className="trip-cover-art__place">{cover.place}</span>
      {size === "hero" && note && <span className="trip-cover-art__note">{note}</span>}
    </div>
  );
}
