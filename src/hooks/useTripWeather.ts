import { useEffect, useState } from "react";
import { fetchTripWeather, type TripWeather } from "../lib/weather";

/**
 * 行き先の天気予報を引く。undefined の間は「まだ引いている最中」で、
 * 画面側は何も出さない — 天気は無くても旅行の日程は読めるので、
 * 読み込み中の枠を確保して場所を空けておく必要は無い。
 *
 * 実際の問い合わせと控えは src/lib/weather.ts が持っている。ここは
 * 画面が閉じたあとに state を触らないようにするだけ。
 */
export function useTripWeather(destination: string): TripWeather | undefined {
  const [weather, setWeather] = useState<TripWeather | undefined>(undefined);

  useEffect(() => {
    if (!destination.trim()) {
      setWeather({ status: "unknown-place", days: [] });
      return;
    }
    let alive = true;
    setWeather(undefined);
    fetchTripWeather(destination).then((result) => {
      if (alive) setWeather(result);
    });
    return () => {
      alive = false;
    };
  }, [destination]);

  return weather;
}
