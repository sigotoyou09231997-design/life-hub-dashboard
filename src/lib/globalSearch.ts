import type { CalendarEvent, Note, SyncedEmail, Task, Trip, TripScheduleItem } from "../types";
import { getNoteType } from "./noteTypes";

export type SearchKind = "event" | "task" | "note" | "trip" | "tripSchedule" | "email";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** 一覧の2行目。どの機能のどのデータに当たったかを一言で示す。 */
  subtitle: string;
  /** 並べ替えに使う日付(YYYY-MM-DD)。日付を持たないデータは空。 */
  date: string;
  /** 押したときの行き先。その機能の既存の画面へ返すだけで、専用の詳細は作らない。 */
  to: string;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
}

export interface SearchSource {
  events: CalendarEvent[];
  tasks: Task[];
  notes: Note[];
  trips: Trip[];
  tripSchedule: TripScheduleItem[];
  emails: SyncedEmail[];
}

const GROUP_LABEL: Record<SearchKind, string> = {
  event: "予定",
  task: "タスク",
  note: "メモ・リスト",
  trip: "旅行",
  tripSchedule: "旅行の日程",
  email: "Gmail",
};

/** 表示の順番。「あの店の名前どこに書いたか」を探す用途なので、自分で書いた
 * ものを上に、届いたメールを下に置く。 */
const GROUP_ORDER: SearchKind[] = ["event", "task", "note", "trip", "tripSchedule", "email"];

/** 1つの機能あたりの表示件数。全部出すと、当たりが多い機能だけで画面が埋まる。 */
export const HITS_PER_GROUP = 8;

const NOTE_TYPE_LABEL = { memo: "メモ", checklist: "チェックリスト", shopping: "買い物リスト" } as const;

function normalize(text: string): string {
  return text.toLowerCase();
}

/** どれか1つでも語を含めば一致。大文字小文字は区別しない(日本語には効かないが、
 * 店名・メールの英字には効く)。 */
function matches(query: string, fields: (string | undefined)[]): boolean {
  const needle = normalize(query);
  return fields.some((field) => field && normalize(field).includes(needle));
}

function joinParts(parts: (string | undefined)[]): string {
  return parts.filter((part) => part && part.trim().length > 0).join(" ・ ");
}

/**
 * 予定・タスク・メモ・旅行・旅行の日程・Gmailを1つの語でまとめて探す。
 * 各画面の個別検索とは独立していて、こちらは「どの機能に当たったか」を
 * 機能ごとの塊にして返す。空の語では何も返さない(全件を出しても意味がない)。
 */
export function searchEverything(query: string, source: SearchSource): SearchGroup[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const tripName = new Map(source.trips.map((trip) => [trip.id ?? "", trip.name]));

  const hits: SearchHit[] = [];

  for (const event of source.events) {
    if (!event.id || !matches(trimmed, [event.title, event.location, event.memo])) continue;
    hits.push({
      kind: "event",
      id: event.id,
      title: event.title,
      subtitle: joinParts([event.date, event.startTime, event.location]),
      date: event.date,
      to: "/schedule?view=list",
    });
  }

  for (const task of source.tasks) {
    if (!task.id || !matches(trimmed, [task.title])) continue;
    hits.push({
      kind: "task",
      id: task.id,
      title: task.title,
      subtitle: joinParts([task.dueDate ? `期限 ${task.dueDate}` : "期限なし", task.completed ? "完了" : undefined]),
      date: task.dueDate ?? "",
      to: "/schedule?view=list",
    });
  }

  for (const note of source.notes) {
    const itemTexts = [
      ...(note.checklistItems ?? []).map((item) => item.title),
      ...(note.shoppingItems ?? []).map((item) => item.name),
    ];
    if (!note.id || !matches(trimmed, [note.title, note.body, note.category, ...note.tags, ...itemTexts])) continue;
    hits.push({
      kind: "note",
      id: note.id,
      title: note.title || "(無題)",
      subtitle: joinParts([NOTE_TYPE_LABEL[getNoteType(note)], note.category, note.body.slice(0, 40)]),
      date: "",
      to: "/records/notes",
    });
  }

  for (const trip of source.trips) {
    if (!trip.id || !matches(trimmed, [trip.name, trip.destination, trip.memo])) continue;
    hits.push({
      kind: "trip",
      id: trip.id,
      title: trip.name,
      subtitle: joinParts([trip.destination, `${trip.startDate}〜${trip.endDate}`]),
      date: trip.startDate,
      to: `/trips/${trip.id}`,
    });
  }

  for (const item of source.tripSchedule) {
    if (!item.id || !matches(trimmed, [item.title, item.location, item.memo])) continue;
    hits.push({
      kind: "tripSchedule",
      id: item.id,
      title: item.title,
      subtitle: joinParts([tripName.get(item.tripId), item.date, item.location]),
      date: item.date,
      to: `/trips/${item.tripId}?tab=schedule`,
    });
  }

  for (const email of source.emails) {
    if (!email.id || !matches(trimmed, [email.subject, email.from, email.snippet])) continue;
    hits.push({
      kind: "email",
      id: email.id,
      title: email.subject || "(件名なし)",
      subtitle: email.from,
      date: "",
      to: `/gmail/mail/${email.id}`,
    });
  }

  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABEL[kind],
    // 日付を持つものは新しい順、持たないものは元の順のまま先頭から。
    hits: hits
      .filter((hit) => hit.kind === kind)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, HITS_PER_GROUP),
  })).filter((group) => group.hits.length > 0);
}

export function countHits(groups: SearchGroup[]): number {
  return groups.reduce((sum, group) => sum + group.hits.length, 0);
}
