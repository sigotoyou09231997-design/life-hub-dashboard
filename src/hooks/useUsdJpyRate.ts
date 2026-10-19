import { useEffect, useState } from "react";
import { fetchRateToYen } from "../lib/currency";
import { FALLBACK_USD_JPY } from "../lib/claudePrice";

/**
 * 1ドルが何円か(その日の為替。src/lib/currency.ts、半日覚えておく)。取れるまで・取れなかった時は目安(FALLBACK_USD_JPY)。
 * live は、その日の為替を取れたか(画面に「目安」と書くかどうか)。
 */
export function useUsdJpyRate(): { rate: number; live: boolean } {
  const [state, setState] = useState<{ rate: number; live: boolean }>({ rate: FALLBACK_USD_JPY, live: false });
  useEffect(() => {
    let alive = true;
    fetchRateToYen("USD")
      .then((rate) => {
        if (alive && rate != null && rate > 0) setState({ rate, live: true });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
