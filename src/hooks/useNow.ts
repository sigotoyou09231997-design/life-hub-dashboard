import { useEffect, useState } from "react";

/** いまの時刻(ミリ秒)。一定の間隔で更新する(ゲージの経過時間を、画面を開いたまま進めるため)。 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
