/**
 * カレンダーの「誰の予定か」。
 *
 * 仕事/プライベート/重要/その他 のカテゴリ(src/lib/scheduleCategories.ts)とは
 * 別の軸として足してある。カテゴリは固定の4つで色も決め打ちだが、こちらは名前も色も
 * 本人が決めるので専用のテーブル(db.eventPeople)を持つ。
 *
 * 予定の側(CalendarEvent.personIds)が持つのは**idの配列**で、名前そのものではない。
 * 名前を変えても予定を1件ずつ付け直さずに済むようにするため。1件に何人でも付けられる
 * (「家族旅行＝自分＋妻＋子供」を1件で表せるようにするため)。
 *
 * アカウント(src/lib/accounts.ts)では代わりにならない。アカウントを切り替えると端末内の
 * DBごと入れ替わるので、1つのカレンダーに並べて色分けする用途には使えないため。
 */
import type { CalendarEvent, EventPerson } from "../types";
import { occursOn } from "./eventSpan";
import { toDateStr } from "./date";
import { addDays, parseISO } from "date-fns";

export interface PersonColorDef {
  value: string;
  label: string;
  /** 点・チップに実際に塗る色。 */
  hex: string;
}

/**
 * 選べる色。暖色・写真ベースの新デザインの機能別の色(src/lib/areaColors.ts と
 * src/styles/theme-warm.css の --tone-*)と同じ、彩度を落とした調子で揃えてある —
 * ここだけ原色にすると、カレンダーの中でこの点だけが浮くため。
 *
 * 予定の行に入れるのは色そのもの(#rrggbb)ではなくこの value。あとで色味を調整した時に、
 * 入っている行を書き換えずに追従させるため。
 */
export const PERSON_COLORS: PersonColorDef[] = [
  { value: "blue", label: "青", hex: "#5e8bbc" },
  { value: "teal", label: "青緑", hex: "#4e9e9b" },
  { value: "green", label: "緑", hex: "#6ba368" },
  { value: "amber", label: "黄", hex: "#d9a441" },
  { value: "orange", label: "橙", hex: "#d08a55" },
  { value: "red", label: "赤", hex: "#dc6355" },
  { value: "pink", label: "桃", hex: "#cc7a9a" },
  { value: "purple", label: "紫", hex: "#7b71c0" },
];

/** 誰のとも決めていない予定の点。今までの「青＝予定」と同じ色にしてあるので、
 * 誰も登録していないうちはカレンダーの見た目がこれまでと変わらない。 */
export const UNASSIGNED_DOT_COLOR = "#5e8bbc";

/** 1日のマスに出す点の上限。増やすとマスの幅を越えるので、超えたぶんは出さない。 */
export const MAX_DAY_DOTS = 3;

/** 絞り込みの「誰も付けていない予定」を表す値。人のidと混ざらない名前にしてある。 */
export const UNASSIGNED_FILTER = "__unassigned__";

/** 知らない色idは既定色として扱い、行そのものは書き換えない(カテゴリと同じ作法)。 */
export function getPersonColor(value: string | undefined): PersonColorDef {
  return PERSON_COLORS.find((c) => c.value === value) ?? PERSON_COLORS[0];
}

export function personColorHex(person: EventPerson): string {
  return getPersonColor(person.color).hex;
}

/** 未設定・壊れた値を空配列に均す。画面側で毎回 ?? [] を書かなくて済むように。 */
export function personIdsOf(event: Pick<CalendarEvent, "personIds">): string[] {
  return Array.isArray(event.personIds) ? event.personIds.filter((id) => typeof id === "string" && id !== "") : [];
}

/** 並び順 → 名前の順。sortOrderが同じ時に名前で決めるのは、同時に足した2人が
 * 端末ごとに違う順で出るのを防ぐため。 */
export function sortPeople(people: EventPerson[]): EventPerson[] {
  return [...people].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
}

/**
 * 予定に付いているidを、人の行に解く。消された人のidが残っていても、その場では
 * 何も出さずに黙って飛ばす — 予定の行を書き換えにいくより、消えた人が出ない方が素直。
 * 並びは人の一覧の順に揃える(予定に付けた順ではない)。同じ予定でも端末や
 * 付けた順で色の並びが変わって見えるのを防ぐため。
 */
export function resolvePeople(event: Pick<CalendarEvent, "personIds">, people: EventPerson[]): EventPerson[] {
  const ids = new Set(personIdsOf(event));
  if (ids.size === 0) return [];
  return sortPeople(people).filter((person) => person.id != null && ids.has(person.id));
}

/** 次に足す人の色。まだ使っていない色を先に配る。全部使い切ったら、いちばん
 * 使われていない色に戻る — 同じ色が2人に付くのは、色が足りない時だけにしたい。 */
export function nextPersonColor(people: EventPerson[]): string {
  const used = new Map<string, number>();
  for (const person of people) {
    const key = getPersonColor(person.color).value;
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  let best = PERSON_COLORS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of PERSON_COLORS) {
    const count = used.get(color.value) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best.value;
}

export function nextSortOrder(people: EventPerson[]): number {
  return people.reduce((max, person) => Math.max(max, person.sortOrder), 0) + 1;
}

/**
 * 絞り込みに当てはまるか。何も選んでいない時は全部通す(絞り込んでいない状態)。
 * UNASSIGNED_FILTER を選ぶと、誰も付けていない予定だけが残る。
 */
export function matchesPersonFilter(event: Pick<CalendarEvent, "personIds">, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const ids = personIdsOf(event);
  if (ids.length === 0) return selected.includes(UNASSIGNED_FILTER);
  return ids.some((id) => selected.includes(id));
}

/**
 * カレンダーの点の色を、日付ごとに集める。またがる予定・繰り返しの将来の回も
 * 含める点の打ち方は collectSpanDatesInRange と同じで、そこに「誰の」の色を足したもの。
 *
 * 返す色は人の一覧の順で、同じ色は1つにまとめる(同じ人の予定が3件ある日に点が3つ
 * 並んでも、分かることは増えない)。誰も付いていない予定がある日は既定色を最後に足す。
 */
export function collectPersonDotsInRange(
  events: CalendarEvent[],
  people: EventPerson[],
  rangeStart: string,
  rangeEnd: string,
): Map<string, string[]> {
  const order = sortPeople(people);
  const rank = new Map<string, number>();
  order.forEach((person, index) => {
    if (person.id) rank.set(person.id, index);
  });

  /** 日付 → その日に出す色の並び順(小さいほど先)。 */
  const byDate = new Map<string, Map<string, number>>();

  function add(date: string, hex: string, at: number): void {
    let slot = byDate.get(date);
    if (!slot) {
      slot = new Map();
      byDate.set(date, slot);
    }
    const current = slot.get(hex);
    if (current == null || at < current) slot.set(hex, at);
  }

  for (const event of events) {
    if (!event.date) continue;
    const assigned = resolvePeople(event, order);
    let cursor = rangeStart > event.date ? rangeStart : event.date;
    while (cursor <= rangeEnd) {
      if (occursOn(event, cursor)) {
        if (assigned.length === 0) {
          // 誰も付いていない予定は最後に回す。人の色より先に出ると、絞り込みの
          // 凡例と並び順が食い違って見えるため。
          add(cursor, UNASSIGNED_DOT_COLOR, Number.MAX_SAFE_INTEGER);
        } else {
          for (const person of assigned) {
            add(cursor, personColorHex(person), rank.get(person.id!) ?? order.length);
          }
        }
      }
      cursor = toDateStr(addDays(parseISO(cursor), 1));
    }
  }

  const out = new Map<string, string[]>();
  for (const [date, slot] of byDate) {
    out.set(
      date,
      [...slot.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, MAX_DAY_DOTS)
        .map(([hex]) => hex),
    );
  }
  return out;
}
