import type { TripScheduleItem } from "../types";
import { TRIP_SCHEDULE_TYPES } from "./tripCategories";
import { longestCommonRun, normalizePlanTitle, planKey, type TripImportRow } from "./mailPlanImport";

/**
 * 旅行の日程を、文章から読み取った内容で「編集」するための部品。
 *
 * これまでの読み取りは追加しかできなかった。同じ予定が既にあると外して見送るだけで、
 * しおりの出発が10時から11時に変わっても、場所が後から分かっても、既存の日程には
 * 反映されない(直すには1件ずつ開いて打ち直す)。ここでは読み取った1行を既存の日程と
 * 1対1で突き合わせ、変わった所だけを更新として差し出す。
 *
 * 決めていること:
 * - 突き合わせるのは**同じ日の日程だけ**。日をまたいで探すと、毎日出てくる「ホテル泊」などを
 *   取り違える。日付が変わった予定は、新しい予定として入り、元の予定は残る。
 * - 文章に**無かった**既存の日程は触らない・消さない(文章が一部の日だけのことも多い)。
 * - 文章に**書かれていない**項目で、既存の値を空にしない。
 * - 既存の日程1件に当てられる行は1行だけ。同じ日程を2つの行が書き換えて、後の行が
 *   前の行の更新を黙って上書きする事故を、突き合わせの段階で起こさせない。
 */

/** 突き合わせの確かさ。strong は同じ予定とみなしてよいもの、loose は片方がもう片方を
 * 含むだけで、別の予定かもしれないもの(既定では選ばず、本人が選んだ時だけ更新する)。 */
export type MatchStrength = "strong" | "loose";

export interface ScheduleMatch {
  /** 突き合わせた既存の日程。 */
  item: TripScheduleItem;
  strength: MatchStrength;
}

/** 突き合わせに使う最小限の形。読み取った行(TripImportRow)がそのまま渡せる。 */
interface Matchable {
  date: string;
  startTime?: string;
  title: string;
}

const STRONG_SCORE = 50;

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** 矢印を落とした題名。「羽田→福岡」と「羽田→大阪」が矢印込みの3文字で同じ語を持つと
 * みなされないようにする(src/lib/mailPlanImport.ts の wordKey と同じ考え)。 */
function wordKey(title: string): string {
  return normalizePlanTitle(title).replace(/[→←↔⇒>]/g, "");
}

/** 読み取った1行と既存の日程1件が、どれだけ同じ予定らしいか(0は別の予定)。 */
function matchScore(row: Matchable, item: Matchable): number {
  if (row.date !== item.date) return 0;
  // 日付・時刻・題名が揃っているものは、書き方の揺れを見るまでもなく同じ。
  if (planKey(row.date, row.startTime, row.title) === planKey(item.date, item.startTime, item.title)) return 100;

  const a = normalizePlanTitle(row.title);
  const b = normalizePlanTitle(item.title);
  if (!a || !b) return 0;

  const bothTimed = !!row.startTime && !!item.startTime;
  const sameTime = bothTimed && row.startTime === item.startTime;
  // 時刻が近いほうを選ぶための小さな加点(同じ題名が1日に2つある時、取り違えないため)。
  const closeness = bothTimed
    ? 1 - Math.min(Math.abs(minutesOf(row.startTime!) - minutesOf(item.startTime!)), 720) / 720
    : 0.5;

  // 題名が同じなら、時刻が変わっていても同じ予定(出発が10時→11時、がいちばんの編集)。
  if (a === b) return (sameTime || (!row.startTime && !item.startTime) ? 90 : 70) + closeness * 5;

  // 題名が違う書き方の時は、時刻が食い違っていたら別の予定とみなす
  // (mergeDuplicateItems と同じ。片方に時刻が無いのは食い違いではない)。
  if (bothTimed && !sameTime) return 0;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // 2文字の短い言葉(「移動」「昼食」)は、別の予定にも普通に出るので、含むだけでは見ない。
  // ただし開始時刻まで同じなら、同じ予定のことがほとんど(「16:40 屋島」と「16:40〜17:20 屋島観光」。
  // 読み直すたびに題名の書き方が変わるので、2文字の題名で取り逃がすと二重に入ってしまう)。
  if (shorter.length >= 3 && longer.includes(shorter)) return sameTime ? 60 : 30;
  if (sameTime && shorter.length === 2 && longer.includes(shorter)) return 55;
  // 同じ時刻に、題名に3文字以上の同じ語がある(「フェリー乗船」と「土庄→高松 フェリー」)。
  if (sameTime && longestCommonRun(wordKey(row.title), wordKey(item.title)) >= 3) return 50;
  return 0;
}

/**
 * 読み取った行それぞれに、いまの日程の中の同じ予定を1対1で当てる(行と同じ並びで返す)。
 * 当たる予定が無い行は undefined = 新しい予定。
 *
 * 点数の高い組から順に確定していく。行の並び順に先着で取ると、早い行の弱い一致が、
 * 後ろの行の確かな一致を横取りしてしまうため。id を持たない日程は更新先にできないので見ない。
 */
export function matchRowsToSchedule(rows: Matchable[], existing: TripScheduleItem[] | undefined): (ScheduleMatch | undefined)[] {
  const result: (ScheduleMatch | undefined)[] = rows.map(() => undefined);
  if (!existing) return result;

  const candidates: { row: number; item: number; score: number }[] = [];
  rows.forEach((row, rowIndex) => {
    existing.forEach((item, itemIndex) => {
      if (!item.id) return;
      const score = matchScore(row, item);
      if (score > 0) candidates.push({ row: rowIndex, item: itemIndex, score });
    });
  });
  candidates.sort((x, y) => y.score - x.score || x.row - y.row || x.item - y.item);

  const usedRows = new Set<number>();
  const usedItems = new Set<number>();
  for (const candidate of candidates) {
    if (usedRows.has(candidate.row) || usedItems.has(candidate.item)) continue;
    usedRows.add(candidate.row);
    usedItems.add(candidate.item);
    result[candidate.row] = {
      item: existing[candidate.item],
      strength: candidate.score >= STRONG_SCORE ? "strong" : "loose",
    };
  }
  return result;
}

/** 更新で書き換えうる項目。 */
export type ChangeField = "title" | "startTime" | "endTime" | "location" | "type" | "memo";

export interface PlanChange {
  field: ChangeField;
  /** 画面に出す項目名。 */
  label: string;
  /** いまの値。空だった項目は undefined。 */
  before?: string;
  after: string;
}

export interface ScheduleUpdate {
  /** db.tripSchedule.update に渡す、変わる項目だけ。 */
  patch: Partial<Pick<TripScheduleItem, ChangeField>>;
  /** 画面に出す前後の比べ。patch と同じ内容。 */
  changes: PlanChange[];
}

function typeLabel(type: TripScheduleItem["type"]): string {
  return TRIP_SCHEDULE_TYPES.find((option) => option.value === type)?.label ?? type;
}

/**
 * 読み取った行を既存の日程に当てた時、何が変わるか。
 *
 * 項目ごとに「書き換えてよい時」を絞ってある — AIが言い換えただけのものまで更新にすると、
 * 読み直すたびに変更点だらけになり、本当の編集が埋もれるため。
 * - 開始・終了時刻: 文章に書かれていて、いまと違う時。
 * - 場所: 文章に書かれていて、いまと違う時。ただし、いまの方が詳しい(「鎌倉駅 西口」に
 *   対して「鎌倉駅」)時は直さない。
 * - 題名: 読み取った方が詳しい(いまの題名を含んでいる)時だけ。言い換えは直さない。
 * - 種類: いまが「その他」の時だけ(本人が選んだ種類をAIの推測で上書きしない)。
 * - メモ: いまが空の時だけ(本人が書いたメモを上書きしない)。
 */
export function diffAgainstSchedule(item: TripScheduleItem, row: TripImportRow): ScheduleUpdate {
  const patch: ScheduleUpdate["patch"] = {};
  const changes: PlanChange[] = [];
  const add = <F extends ChangeField>(field: F, label: string, value: NonNullable<TripScheduleItem[F]>, before: string | undefined, after: string) => {
    patch[field] = value;
    changes.push({ field, label, before: before || undefined, after });
  };

  if (row.startTime && row.startTime !== item.startTime) add("startTime", "開始", row.startTime, item.startTime, row.startTime);
  if (row.endTime && row.endTime !== item.endTime) add("endTime", "終了", row.endTime, item.endTime, row.endTime);

  const location = row.location?.trim();
  if (location) {
    const now = item.location?.trim() ?? "";
    const nowKey = normalizePlanTitle(now);
    const nextKey = normalizePlanTitle(location);
    if (nextKey && nextKey !== nowKey && !(nowKey && nowKey.includes(nextKey))) add("location", "場所", location, now, location);
  }

  const title = row.title.trim();
  const titleKey = normalizePlanTitle(title);
  const itemTitleKey = normalizePlanTitle(item.title);
  if (itemTitleKey.length >= 3 && titleKey !== itemTitleKey && titleKey.includes(itemTitleKey)) {
    add("title", "題名", title, item.title, title);
  }

  if (item.type === "other" && row.type !== "other") add("type", "種類", row.type, typeLabel(item.type), typeLabel(row.type));

  const memo = row.memo?.trim();
  if (memo && !item.memo?.trim()) add("memo", "メモ", memo, undefined, memo);

  // 並びを画面で読みやすい順にそろえる(題名 → 時刻 → 場所 → 種類 → メモ)。
  const order: ChangeField[] = ["title", "startTime", "endTime", "location", "type", "memo"];
  changes.sort((x, y) => order.indexOf(x.field) - order.indexOf(y.field));
  return { patch, changes };
}

/** 読み取り画面で1行ごとに持つ状態。TripImportRow に、突き合わせ先と「更新するか」を足したもの。 */
export interface ScanRow extends TripImportRow {
  /** 突き合わせた既存の日程の id。無ければ新しい予定として入れる。 */
  matchId?: string;
  matchStrength?: MatchStrength;
  /** matchId がある時、その日程を更新する(true)か、別の予定として追加する(false)か。 */
  update: boolean;
  /** 更新にはならないが、同じ予定らしい日程の題名。重ねて入れることになるので断りを出す。 */
  similarTitle?: string;
}

/** 入れ終わった知らせ。追加だけの時は、これまでと同じ文言(「日程に3件入れました」)。 */
export function describeScanSaved(added: number, updated: number, expenses: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`日程に${added}件`);
  if (expenses > 0) parts.push(`費用に${expenses}件`);
  if (updated === 0) return `${parts.join("、")}入れました`;
  if (parts.length === 0) return `日程を${updated}件更新しました`;
  return `${parts.join("、")}入れ、日程を${updated}件更新しました`;
}
