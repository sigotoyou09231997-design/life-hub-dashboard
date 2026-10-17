import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Concern } from "../../lib/homeLayout";
import { openQuickAdd } from "../layout/AddChooser";

/** 解消した行が右へすっと消える時間(ms)。CSS の .is-leaving と同じ長さ。 */
export const LEAVE_MS = 260;

/**
 * ホームの「気になること」(Cowork「ホームの組み直し」1-2、2026-10-17)。
 * 放っておくと困ること(返信待ち・予算超えの予兆・期限切れ)と、設定が未完のもの(連携切れ・住所)だけを
 * 1行ずつ出す。行 = 色の点 ＋ 一言 ＋ 右に押せる文字。文字の色は黒のまま、点だけ色を付ける。
 * 行の元(どれを出すか)は src/lib/homeLayout.ts の buildConcerns。1件も無い日は、カードを出さず1行の文だけ。
 *
 * 解消した行(返信が来た・住所を入れた)は、すぐ消さずに LEAVE_MS のあいだ右へ流れてから消える(3本目の仕上げ)。
 * 「視差効果を減らす」の時は、CSS 側で動きを無くす。
 */
export function HomeAttention({ concerns }: { concerns: Concern[] }) {
  // いま出ている行と、消えかけの行(id → 行)。消えかけは LEAVE_MS 後に落とす。
  const [leaving, setLeaving] = useState<Concern[]>([]);
  const prevRef = useRef<Concern[]>(concerns);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = concerns;
    const ids = new Set(concerns.map((c) => c.id));
    const gone = prev.filter((c) => !ids.has(c.id));
    if (gone.length === 0) return;
    setLeaving((rows) => [...rows.filter((r) => !ids.has(r.id)), ...gone.filter((g) => !rows.some((r) => r.id === g.id))]);
    const timer = window.setTimeout(() => setLeaving((rows) => rows.filter((r) => !gone.some((g) => g.id === r.id))), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [concerns]);

  if (concerns.length === 0 && leaving.length === 0) {
    return <p className="lh-concern-none">気になることはありません</p>;
  }
  const shown: { concern: Concern; isLeaving: boolean }[] = [
    ...concerns.map((concern) => ({ concern, isLeaving: false })),
    ...leaving.map((concern) => ({ concern, isLeaving: true })),
  ];
  return (
    <div className="warm-card lh-group lh-concern">
      {shown.map(({ concern, isLeaving }) => {
        const className = `lh-row lh-concern__row${isLeaving ? " is-leaving" : ""}`;
        const body = (
          <>
            <i className={`lh-concern__dot is-${concern.tone}`} aria-hidden="true" />
            <span className="lh-row__copy">
              <strong>{concern.text}</strong>
              {concern.note && <small>{concern.note}</small>}
            </span>
            <span className="lh-concern__cta">{concern.cta}</span>
          </>
        );
        if (isLeaving) {
          return (
            <div key={concern.id} className={className} aria-hidden="true">
              {body}
            </div>
          );
        }
        if (concern.action) {
          const kind = concern.action;
          return (
            <button key={concern.id} type="button" className={className} onClick={() => openQuickAdd(kind)}>
              {body}
            </button>
          );
        }
        return (
          <Link key={concern.id} to={concern.to ?? "/"} className={className}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
