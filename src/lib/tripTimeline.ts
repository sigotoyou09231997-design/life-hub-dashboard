import { spanTimeText } from "./eventSpan";

/** 日程の時間軸の左の列に出す時刻。 */
export interface TimelineTime {
  /** 大きく出す方。時刻なら「06:48」。 */
  main: string;
  /** その下に小さく出す補足。終了時刻なら「〜10:10」。 */
  sub?: string;
  /** 時刻ではなく「終日」「時刻なし」のような言葉。時刻より小さく淡く出す。 */
  plain: boolean;
}

/**
 * 日程1件の時刻を、時間軸の左の列に縦に並べやすい形に分ける。
 *
 * 以前は「06:48〜10:10 東京発 のぞみ」のように題名の横へ小さく出していたので、
 * 1日の流れを上から目で追っても、時刻が題名の長さの分だけずれて拾いにくかった。
 * 時刻の書き方の決まり(またがる日程の初日は「10:00〜」、最終日は「〜13:00」)は
 * spanTimeText のままにして、ここでは見せ方だけを分ける。
 */
export function timelineTimeParts(
  item: Parameters<typeof spanTimeText>[0],
  onDate?: string,
): TimelineTime {
  const text = spanTimeText(item, onDate);
  const range = /^(\d{1,2}:\d{2})〜(\d{1,2}:\d{2})$/.exec(text);
  if (range) return { main: range[1], sub: `〜${range[2]}`, plain: false };
  const from = /^(\d{1,2}:\d{2})〜$/.exec(text);
  if (from) return { main: from[1], sub: "から", plain: false };
  const until = /^〜(\d{1,2}:\d{2})$/.exec(text);
  if (until) return { main: until[1], sub: "まで", plain: false };
  if (/^\d{1,2}:\d{2}$/.test(text)) return { main: text, plain: false };
  // 「終日」「時刻未設定」。列の幅に収まる短い言い方にする。
  return { main: text === "時刻未設定" ? "時刻なし" : text, plain: true };
}

/**
 * 同じ日の中で、前の日程の終わりより早く始まる日程を見つける(第36弾)。
 * 参考: @FaizalSukaimi「旅程ビルダー: 時間のチェックと、ワンタップの直し」。直しの操作までは付けず、
 * 「前と重なっています」と気づかせるところまで。
 *
 * 当てるのは、1日で終わる・開始と終了の両方の時刻がある日程の「次」に来る、開始時刻のある日程だけ。
 * 宿泊(チェックイン・アウトの時刻で動く)と、何日かにまたがる日程は対象にしない。
 * 開始時刻が前の終了時刻と同じ(ちょうど乗り換え)は重なりではない。
 */
export function findTimeClashes(
  items: ReadonlyArray<{ id?: string; type?: string; date: string; endDate?: string; startTime?: string; endTime?: string }>,
): Set<string> {
  const clashes = new Set<string>();
  const toMin = (time: string | undefined): number | null => {
    const m = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const timed = items
    .filter((item) => item.type !== "lodging" && (!item.endDate || item.endDate === item.date))
    .map((item) => ({ item, start: toMin(item.startTime), end: toMin(item.endTime) }))
    .filter((entry): entry is { item: (typeof items)[number]; start: number; end: number | null } => entry.start !== null)
    .sort((a, b) => a.start - b.start);
  let latestEnd: number | null = null;
  for (const entry of timed) {
    if (latestEnd !== null && entry.start < latestEnd && entry.item.id) clashes.add(entry.item.id);
    if (entry.end !== null && entry.end > entry.start) latestEnd = Math.max(latestEnd ?? 0, entry.end);
  }
  return clashes;
}
