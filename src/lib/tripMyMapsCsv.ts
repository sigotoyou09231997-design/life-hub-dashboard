import type { Trip, TripScheduleItem } from "../types";
import { tripDayList } from "./date";
import { TRIP_SCHEDULE_TYPES } from "./tripCategories";
import { csvCell } from "./transactionCsv";
import { compareScheduleDateTime } from "./scheduleOrder";

/**
 * 旅行の日程を Google マイマップに取り込むための CSV。
 *
 * マイマップには地図を作る・書き込むAPIが無く、できるのは画面から CSV/KML などを
 * 取り込むことだけ(https://support.google.com/mymaps/answer/3024836)。CSV は
 * 「場所」の列の住所・地名をマイマップ側で探して置いてくれるので、こちらで座標を
 * 持つ必要はない(GOOGLE_MAPS_API_KEY が未発行でも使える)。
 *
 * 書き出し方は2通り。
 * - 全日程を1ファイル=1レイヤーにまとめる(buildTripMyMapsCsv)。「日目」の列を付けてあり、
 *   取り込んだあとマイマップの「スタイル」で選べば日ごとに色分けできる。
 * - 1日ぶん=1ファイル=1レイヤーに分ける(buildTripMyMapsDayFiles)。マイマップは1回の
 *   取り込みで1枚のレイヤーしか作らず、複数シートのExcelや複数フォルダのKMLが
 *   レイヤーに分かれるとは公式に書かれていない。確実なのは1日1ファイルを取り込む形。
 *   ただし1つの地図に置けるレイヤーは10枚までなので、11日以上の旅行は入り切らない。
 */
export const MYMAPS_CSV_HEADER = ["場所", "名前", "日目", "日付", "終了日", "時刻", "種類", "メモ"] as const;

export interface MyMapsExport {
  csv: string;
  /** 地図に置ける(場所が入っている)日程の数。 */
  placed: number;
  /** 場所が空で、地図に置けなかった日程。画面でそのまま見せる。 */
  skipped: TripScheduleItem[];
}

/** 1日ぶんのファイル。レイヤー名はマイマップがファイル名から付けるので、先頭を「n日目」にしてある。 */
export interface MyMapsDayFile {
  /** 「1日目」。旅行の期間の外の日付は、その日付をそのまま使う。 */
  label: string;
  filename: string;
  csv: string;
  placed: number;
}

const TYPE_LABEL = new Map(TRIP_SCHEDULE_TYPES.map((t) => [t.value, t.label]));


function timeLabel(item: TripScheduleItem): string {
  if (item.startTime && item.endTime) return `${item.startTime}〜${item.endTime}`;
  if (item.startTime) return item.startTime;
  if (item.endTime) return `〜${item.endTime}`;
  return "";
}

/** 日程を並べ、場所のある日程と場所が空の日程に分ける。 */
function prepare(trip: Trip, schedule: TripScheduleItem[]) {
  const dayNumber = new Map(tripDayList(trip.startDate, trip.endDate).map((date, index) => [date, index + 1]));
  const sorted = [...schedule].sort(compareScheduleDateTime);
  return {
    dayNumber,
    placedItems: sorted.filter((item) => item.location?.trim()),
    skipped: sorted.filter((item) => !item.location?.trim()),
  };
}

/** 日程をCSV本文にする。改行はExcelでもそのまま開けるCRLF。 */
function toCsv(items: TripScheduleItem[], dayNumber: Map<string, number>): string {
  const rows = [
    MYMAPS_CSV_HEADER.join(","),
    ...items.map((item) => {
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
  return rows.join("\r\n");
}

/** 全日程を1つのCSVにまとめる。 */
export function buildTripMyMapsCsv(trip: Trip, schedule: TripScheduleItem[]): MyMapsExport {
  const { dayNumber, placedItems, skipped } = prepare(trip, schedule);
  return { csv: toCsv(placedItems, dayNumber), placed: placedItems.length, skipped };
}

/** 日ごとに1ファイルずつ作る。日程の無い日・場所が1つも無い日のファイルは作らない。 */
export function buildTripMyMapsDayFiles(
  trip: Trip,
  schedule: TripScheduleItem[],
): { files: MyMapsDayFile[]; skipped: TripScheduleItem[] } {
  const { dayNumber, placedItems, skipped } = prepare(trip, schedule);
  // placedItems は日付順に並んでいるので、Map に入れた順がそのまま日の順になる。
  const groups = new Map<string, TripScheduleItem[]>();
  for (const item of placedItems) {
    const group = groups.get(item.date);
    if (group) group.push(item);
    else groups.set(item.date, [item]);
  }
  const files = [...groups].map(([date, items]) => {
    const day = dayNumber.get(date);
    const label = day ? `${day}日目` : date;
    return {
      label,
      filename: tripMyMapsDayFilename(label, trip.name),
      csv: toCsv(items, dayNumber),
      placed: items.length,
    };
  });
  return { files, skipped };
}

/** ファイル名に使えない文字(OSによって禁止されるもの)を取り除く。 */
function safeTripName(tripName: string): string {
  return tripName.replace(/[\\/:*?"<>|]/g, "").trim() || "旅行";
}

export function tripMyMapsFilename(tripName: string): string {
  return `${safeTripName(tripName)}-マイマップ用.csv`;
}

/** 「1日目-旅行名.csv」。マイマップはレイヤー名をファイル名から付けるので、日を先頭に置く
 * (レイヤーの一覧は幅が狭く、後ろが切れる)。旅行名を残すのは、別の旅行の同名ファイルが
 * ダウンロード先に残っていて「1日目 (1).csv」になるのを避けるため。 */
export function tripMyMapsDayFilename(label: string, tripName: string): string {
  return `${label}-${safeTripName(tripName)}.csv`;
}
