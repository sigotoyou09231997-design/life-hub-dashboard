import { Cloud, CloudDrizzle, CloudFog, CloudRain, CloudSnow, CloudSun, Sun, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatShortDate } from "../../lib/date";
import {
  describeWeather,
  forecastForDate,
  forecastHorizon,
  type DailyForecast,
  type TripWeather,
  type WeatherIconName,
} from "../../lib/weather";

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

/**
 * PCの日程タブの右の欄(TripDayPanel)に出す、見ている日の天気。見出しの横の小さな天気
 * (TripDayWeather)と同じ予報を、言葉(晴れ・雨…)と降水確率まで出して少し大きく見せる。
 * 右の欄は横に余裕があるので、見出しの1行に収めるために畳んだものをここで広げる。
 *
 * 予報が無い日も、何も出さないのではなく理由を1行で書く — 欄ごと消えると、
 * 天気が出ない旅行なのか、まだ先の日だからなのかが分からない。
 */
export function TripDayWeatherCard({ weather, date }: { weather?: TripWeather; date: string }) {
  if (!weather) return <p className="trip-day-forecast__note">天気予報を調べています…</p>;
  if (weather.status !== "ok") {
    return (
      <p className="trip-day-forecast__note">
        {weather.status === "unknown-place"
          ? "行き先の地名から、天気予報の場所が分かりませんでした。"
          : "天気予報を読み込めませんでした。あとで開き直すと、もう一度調べます。"}
      </p>
    );
  }

  const forecast = forecastForDate(weather.days, date);
  // どこの予報かは、PCでは左の日程の上の断り書き(TripWeatherBanner)を出さないので、ここで必ず書く。
  const { name, country } = weather.place ?? {};
  const placeLabel = name ? `${name}${country && country !== name ? `(${country})` : ""}の予報` : undefined;
  if (!forecast) {
    const horizon = forecastHorizon(weather.days);
    const first = weather.days[0]?.date;
    return (
      <div className="trip-day-forecast">
        <p className="trip-day-forecast__note trip-day-forecast__wide">
          {horizon && date > horizon
            ? `${formatShortDate(horizon)}より先は、まだ予報が出ていません。`
            : first && date < first
              ? "過ぎた日の天気は出せません。"
              : "この日の予報はありません。"}
        </p>
        {placeLabel && <small className="trip-day-forecast__place">{placeLabel}</small>}
      </div>
    );
  }

  const look = describeWeather(forecast.weatherCode);
  const Icon = ICONS[look.icon];
  const rain = forecast.precipitationChance;
  return (
    <div className="trip-day-forecast">
      <Icon size={30} aria-hidden="true" className="trip-day-forecast__icon" />
      <div className="trip-day-forecast__main">
        <strong>{look.label}</strong>
        <span>
          最高 <b>{forecast.tempMax}°</b> / 最低 {forecast.tempMin}°
        </span>
      </div>
      {rain != null && (
        <span className={`trip-day-forecast__rain${rain >= RAIN_CHANCE_THRESHOLD ? " is-high" : ""}`}>
          降水 {rain}%
        </span>
      )}
      {placeLabel && <small className="trip-day-forecast__place">{placeLabel}</small>}
    </div>
  );
}
