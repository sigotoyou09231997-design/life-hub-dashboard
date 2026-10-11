import type { Trip, TripScheduleItem } from "../types";
import { tripDayList } from "./date";
import { TRIP_SCHEDULE_TYPES } from "./tripCategories";
import { csvCell } from "./transactionCsv";

/**
 * 旅行の日程を Google マイマップに取り込むための CSV。
 *
 * マイマップには地図を作る・書き込むAPIが無く、できるのは画面から CSV/KML などを
 * 取り込むことだけ(https://support.google.com/mymaps/answer/3024836)。CSV は
 * 「場所」の列の住所・地名をマイマップ側で探して置いてくれるので、こちらで座標を
 * 持つ必要はない(GOOGLE_MAPS_API_KEY が未発行でも使える)。
 *
 * 全日程を1ファイル=1レイヤーにして「日目」の列を付けてある。日ごとに分けると
 * 1つの地図に置けるレイヤーは10枚までなので、11日以上の旅行が入らなくなる。
 * 取り込んだあと、マイマップの「スタイル」で「日目」を選べば日ごとに色分けできる。
 */
export const MYMAPS_CSV_HEADER = ["場所", "名前", "日目", "日付", "終了日", "時刻", "種類", "メモ"] as const;

export interface MyMapsExport {
  csv: string;
  /** 地図に置ける(場所が入っている)日程の数。 */
  placed: number;
  /** 場所が空で、地図に置けなかった日程。画面でそのまま見せる。 */
  skipped: TripScheduleItem[];
}

const TYPE_LABEL = new Map(TRIP_SCHEDULE_TYPES.map((t) => [t.value, t.label]));

function byDateThenTime(a: TripScheduleItem, b: TripScheduleItem): number {
  return (
    a.date.localeCompare(b.date) ||
    (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
    a.createdAt - b.createdAt
  );
}

function timeLabel(item: TripScheduleItem): string {
  if (item.startTime && item.endTime) return `${item.startTime}〜${item.endTime}`;
  if (item.startTime) return item.startTime;
  if (item.endTime) return `〜${item.endTime}`;
  return "";
}

/** 日程をマイマップ用のCSV本文にする。改行はExcelでもそのまま開けるCRLF。 */
export function buildTripMyMapsCsv(trip: Trip, schedule: TripScheduleItem[]): MyMapsExport {
  const dayNumber = new Map(tripDayList(trip.startDate, trip.endDate).map((date, index) => [date, index + 1]));
  const sorted = [...schedule].sort(byDateThenTime);
  const placedItems = sorted.filter((item) => item.location?.trim());
  const skipped = sorted.filter((item) => !item.location?.trim());

  const rows = [
    MYMAPS_CSV_HEADER.join(","),
    ...placedItems.map((item) => {
      const day = dayNumber.get(item.date);
      return [
        csvCell(item.location?.trim()),
        csvCell(item.title),
        csvCell(day ? `${day}日目` : ""),
        csvCell(item.date),
        csvCell(item.endDate),
        csvCell(timeLabel(item)),
        csvCell(TYPE_LABEL.get(item.type)),
        csvCell(item.memo),
      ].join(",");
    }),
  ];
  return { csv: rows.join("\r\n"), placed: placedItems.length, skipped };
}

/** ファイル名に使えない文字(OSによって禁止されるもの)を取り除く。 */
export function tripMyMapsFilename(tripName: string): string {
  const safe = tripName.replace(/[\\/:*?"<>|]/g, "").trim() || "旅行";
  return `${safe}-マイマップ用.csv`;
}
