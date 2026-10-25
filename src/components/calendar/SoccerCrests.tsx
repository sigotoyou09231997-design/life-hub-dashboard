import { useState } from "react";
import { soccerCrestUrl, type SoccerMatchInfo } from "../../lib/soccerMatch";

function Crest({ id, size }: { id: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="soccer-duo__blank" style={{ width: size, height: size, fontSize: size * 0.6 }} aria-hidden>⚽</span>;
  return (
    <img
      className="soccer-duo__crest"
      src={soccerCrestUrl(id)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * 取り込んだサッカーの試合の、2チームの紋章(ホーム・アウェイ)。カレンダーのマスと予定の一覧で使う(見た目は src/styles/soccer.css)。
 * チームのidが分からない古い予定は、紋章の代わりにボールの印を出す。
 */
export function SoccerCrests({ match, size = 16 }: { match: Pick<SoccerMatchInfo, "homeId" | "awayId">; size?: number }) {
  if (!match.homeId || !match.awayId) {
    return (
      <span className="soccer-duo soccer-duo--ball" style={{ fontSize: size * 0.9 }} aria-hidden>
        ⚽
      </span>
    );
  }
  return (
    <span className="soccer-duo" aria-hidden>
      <Crest id={match.homeId} size={size} />
      <Crest id={match.awayId} size={size} />
    </span>
  );
}
