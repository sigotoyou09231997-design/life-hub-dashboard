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
