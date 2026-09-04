import { Cloud, CloudDrizzle, CloudFog, CloudRain, CloudSnow, CloudSun, Sun, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatShortDate } from "../../lib/date";
import { describeWeather, type DailyForecast, type WeatherIconName } from "../../lib/weather";

const ICONS: Record<WeatherIconName, LucideIcon> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunder: Zap,
};

/** 傘を持つか迷い始める辺り。これ未満は数字を出さずに畳む(見出しの1行に収めるため)。 */
const RAIN_CHANCE_THRESHOLD = 30;

/**
 * 日程タブの「N日目」の見出しに並べる、その日の天気。
 *
 * 見出しの1行に収まる大きさに留めている — 日程そのものより天気が目立つと、
 * 何を見る画面なのか分からなくなるため。
 */
export function TripDayWeather({ forecast }: { forecast: DailyForecast }) {
  const look = describeWeather(forecast.weatherCode);
  const Icon = ICONS[look.icon];
  const rain = forecast.precipitationChance;
  const showRain = rain != null && rain >= RAIN_CHANCE_THRESHOLD;

  return (
    <span
      className="trip-day__weather"
      aria-label={`${look.label} 最高${forecast.tempMax}度 最低${forecast.tempMin}度${
        rain != null ? ` 降水確率${rain}パーセント` : ""
      }`}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="trip-day__weather-max">{forecast.tempMax}°</span>
      <span className="trip-day__weather-min">{forecast.tempMin}°</span>
      {showRain && <span className="trip-day__weather-rain">{rain}%</span>}
    </span>
  );
}

interface BannerProps {
  placeName: string;
  country?: string;
  /** 予報を出せる最終日(YYYY-MM-DD)。 */
  horizon?: string;
  /** 旅行の最終日がその先にあるか(＝出せない日がある)。 */
  beyondHorizon: boolean;
}

/**
 * どこの予報を出しているかの断り書き。行き先は自由文なので、こちらが「京都・大阪」を
 * 「京都市」と読んだことは見えるようにしておく — 違う土地を出していたら気づけるように。
 */
export function TripWeatherBanner({ placeName, country, horizon, beyondHorizon }: BannerProps) {
  return (
    <p className="trip-weather-note">
      <span>
        {placeName}
        {country && country !== placeName ? `(${country})` : ""}の天気予報
      </span>
      {beyondHorizon && horizon && <span>{formatShortDate(horizon)}より先はまだ予報が出ていません</span>}
    </p>
  );
}
