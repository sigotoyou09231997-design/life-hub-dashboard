import type { TripScheduleItem, TripTransportMode } from "../types";

/**
 * 旅行の日程で、続けて並ぶ「移動」の予定を1本の「つなぎ」にまとめる(UI/UX 調査メモ 第6弾 D-1、2026-10-17)。
 *
 * 「JR小金井駅→東京駅」「東京→岡山 新幹線」「岡山→高松 マリンライナー」が1件ずつ並ぶと、場所の予定と同じ重さで
 * 行が増え、「どこに行く日か」が埋もれる。同じ日の中で type が "transport" の予定が1つ以上続いていたら、
 * 前後の場所の予定のあいだに「電車・新幹線 6時間21分」の小さな札として出し、押した時だけ1件ずつに開く。
 * データは変えない(移動の予定はそのまま保存されている)。見せ方だけ。
 */
export type ScheduleSegment =
  | { kind: "item"; item: TripScheduleItem }
  | {
      kind: "connector";
      /** 中の予定の id をつないだもの。開いているかどうかを覚える鍵。 */
      key: string;
      items: TripScheduleItem[];
      /** つなぎのすぐ後の予定(所要時間の終わりに使う)。日の最後なら null。 */
      next: TripScheduleItem | null;
      open: boolean;
    };

export function connectorKey(items: TripScheduleItem[]): string {
  return items.map((item) => item.id ?? item.title).join("+");
}

/**
 * 1日の予定(並び順どおり)を、場所の予定と「つなぎ」に分ける。open に鍵がある(か expandAll)つなぎは、
 * 札の後ろに中の予定を1件ずつ続けて出す(編集・並べ替えは開いた状態で今までどおり)。
 */
export function segmentSchedule(
  items: TripScheduleItem[],
  options: { open?: ReadonlySet<string>; expandAll?: boolean } = {},
): ScheduleSegment[] {
  const segments: ScheduleSegment[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.type !== "transport") {
      segments.push({ kind: "item", item });
      i += 1;
      continue;
    }
    let j = i;
    while (j < items.length && items[j].type === "transport") j += 1;
    const group = items.slice(i, j);
    const key = connectorKey(group);
    const open = Boolean(options.expandAll || options.open?.has(key));
    segments.push({ kind: "connector", key, items: group, next: items[j] ?? null, open });
    if (open) for (const inner of group) segments.push({ kind: "item", item: inner });
    i = j;
  }
  return segments;
}

/** 札に出す移動手段(同じものは1回。選んでいない移動は数えない)。 */
export function connectorModes(items: TripScheduleItem[]): TripTransportMode[] {
  const modes: TripTransportMode[] = [];
  for (const item of items) if (item.transportMode && !modes.includes(item.transportMode)) modes.push(item.transportMode);
  return modes;
}

function minutesOf(time: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * 所要時間(分)。最初の移動の開始から、最後の移動の終了(無ければ次の場所の予定の開始)まで。
 * どちらかが無い・逆転している時は null(札には出さない)。
 */
export function connectorMinutes(items: TripScheduleItem[], next: TripScheduleItem | null): number | null {
  const start = minutesOf(items[0]?.startTime);
  const last = items[items.length - 1];
  const end = minutesOf(last?.endTime) ?? minutesOf(next?.startTime);
  if (start === null || end === null || end < start) return null;
  return end - start;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
