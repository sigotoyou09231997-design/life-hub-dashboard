import { useState } from "react";
import { soccerCrestUrl, type SoccerMatchInfo } from "../../lib/soccerMatch";

function Crest({ id, size }: { id?: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (!id || broken) {
    return (
      <span className="soccer-vs__blank" style={{ width: size, height: size, fontSize: size * 0.62 }} aria-hidden>
        ⚽
      </span>
    );
  }
  return (
    <img
      className="soccer-vs__crest"
      src={soccerCrestUrl(id)}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
    />
  );
}

/**
 * 月表示のマス用: 「紋章 vs 紋章」だけ(マスが狭く、チーム名は入らない)。題名は押した先の一覧で読める。
 * チームのidが分からない古い予定は、紋章の代わりにボールの印を出す。
 */
export function SoccerCrests({ match, size = 16 }: { match: Pick<SoccerMatchInfo, "homeId" | "awayId">; size?: number }) {
  return (
    <span className="soccer-vs soccer-vs--crests" aria-hidden>
      <Crest id={match.homeId} size={size} />
      <i className="soccer-vs__v">vs</i>
      <Crest id={match.awayId} size={size} />
    </span>
  );
}

/**
 * 一覧・週表示用: 「[紋章] ホーム vs [紋章] アウェイ」。紋章は、それぞれのチーム名の左に置く。
 * 名前が長い時は、チームごとに折り返す(紋章と名前が離れ離れにならないように)。
 */
export function SoccerMatchTitle({ match, size = 20 }: { match: SoccerMatchInfo; size?: number }) {
  return (
    <span className="soccer-vs">
      <span className="soccer-vs__team">
        <Crest id={match.homeId} size={size} />
        <span>{match.homeName}</span>
      </span>
      {match.awayName && (
        <>
          <i className="soccer-vs__v">vs</i>
          <span className="soccer-vs__team">
            <Crest id={match.awayId} size={size} />
            <span>{match.awayName}</span>
          </span>
        </>
      )}
    </span>
  );
}
