import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventPerson } from "../types";
import {
  MAX_DAY_DOTS,
  PERSON_COLORS,
  UNASSIGNED_DOT_COLOR,
  UNASSIGNED_FILTER,
  collectPersonDotsInRange,
  getPersonColor,
  matchesPersonFilter,
  nextPersonColor,
  nextSortOrder,
  personColorHex,
  personIdsOf,
  resolvePeople,
  sortPeople,
} from "./eventPeople";

function person(id: string, name: string, color: string, sortOrder: number): EventPerson {
  return { id, name, color, sortOrder, createdAt: 0 };
}

const me = person("p-me", "自分", "blue", 1);
const wife = person("p-wife", "妻", "green", 2);
const kid = person("p-kid", "子供", "orange", 3);
const people = [me, wife, kid];

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return { title: "予定", date: "2026-09-10", createdAt: 0, ...over };
}

describe("色", () => {
  it("知らない色idは既定色として読む(行は書き換えない)", () => {
    expect(getPersonColor("no-such-color").value).toBe(PERSON_COLORS[0].value);
    expect(getPersonColor(undefined).value).toBe(PERSON_COLORS[0].value);
  });

  it("次の色は、まだ使っていないものから配る", () => {
    expect(nextPersonColor([])).toBe(PERSON_COLORS[0].value);
    expect(nextPersonColor([me])).toBe(PERSON_COLORS[1].value);
  });

  it("色を使い切ったら、いちばん使われていない色に戻る", () => {
    // 全色を1人ずつ使い、先頭の色だけもう1人が使っている状態。
    const all = PERSON_COLORS.map((c, i) => person(`p${i}`, `人${i}`, c.value, i + 1));
    const crowded = [...all, person("extra", "追加", PERSON_COLORS[0].value, 99)];
    expect(nextPersonColor(crowded)).toBe(PERSON_COLORS[1].value);
  });

  it("並び順の次の番号を返す", () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder(people)).toBe(4);
  });
});

describe("予定に付いた人を解く", () => {
  it("未設定・空・壊れた値はどれも空配列になる", () => {
    expect(personIdsOf(event({}))).toEqual([]);
    expect(personIdsOf(event({ personIds: [] }))).toEqual([]);
    expect(personIdsOf({ personIds: ["", "p-me"] } as CalendarEvent)).toEqual(["p-me"]);
  });

  it("並びは付けた順ではなく、人の一覧の順に揃える", () => {
    const resolved = resolvePeople(event({ personIds: ["p-kid", "p-me"] }), people);
    expect(resolved.map((p) => p.name)).toEqual(["自分", "子供"]);
  });

  it("消された人のidが残っていても、黙って飛ばす", () => {
    const resolved = resolvePeople(event({ personIds: ["p-gone", "p-wife"] }), people);
    expect(resolved.map((p) => p.name)).toEqual(["妻"]);
  });

  it("sortOrderが同じ時は名前で決める(端末ごとに順が変わらないように)", () => {
    const a = person("a", "あや", "blue", 1);
    const b = person("b", "いつき", "green", 1);
    expect(sortPeople([b, a]).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("絞り込み", () => {
  it("何も選んでいなければ全部通す", () => {
    expect(matchesPersonFilter(event({}), [])).toBe(true);
    expect(matchesPersonFilter(event({ personIds: ["p-me"] }), [])).toBe(true);
  });

  it("選んだ人が1人でも付いていれば残る", () => {
    expect(matchesPersonFilter(event({ personIds: ["p-me", "p-kid"] }), ["p-kid"])).toBe(true);
    expect(matchesPersonFilter(event({ personIds: ["p-me"] }), ["p-kid"])).toBe(false);
  });

  it("「誰も付けていない」だけを選べる", () => {
    expect(matchesPersonFilter(event({}), [UNASSIGNED_FILTER])).toBe(true);
    expect(matchesPersonFilter(event({ personIds: ["p-me"] }), [UNASSIGNED_FILTER])).toBe(false);
  });
});

describe("カレンダーの点", () => {
  it("人の色を、人の一覧の順に出す", () => {
    const dots = collectPersonDotsInRange(
      [event({ date: "2026-09-10", personIds: ["p-kid", "p-me"] })],
      people,
      "2026-09-01",
      "2026-09-30",
    );
    expect(dots.get("2026-09-10")).toEqual([personColorHex(me), personColorHex(kid)]);
  });

  it("誰も付いていない予定は、これまでと同じ色の点1つ", () => {
    const dots = collectPersonDotsInRange([event({ date: "2026-09-10" })], people, "2026-09-01", "2026-09-30");
    expect(dots.get("2026-09-10")).toEqual([UNASSIGNED_DOT_COLOR]);
  });

  it("同じ人の予定が何件あっても、点は1つにまとめる", () => {
    const dots = collectPersonDotsInRange(
      [
        event({ id: "a", date: "2026-09-10", personIds: ["p-me"] }),
        event({ id: "b", date: "2026-09-10", personIds: ["p-me"] }),
      ],
      people,
      "2026-09-01",
      "2026-09-30",
    );
    expect(dots.get("2026-09-10")).toEqual([personColorHex(me)]);
  });

  it("誰も付いていない予定の色は、人の色より後ろに回す", () => {
    const dots = collectPersonDotsInRange(
      [event({ id: "a", date: "2026-09-10" }), event({ id: "b", date: "2026-09-10", personIds: ["p-kid"] })],
      people,
      "2026-09-01",
      "2026-09-30",
    );
    expect(dots.get("2026-09-10")).toEqual([personColorHex(kid), UNASSIGNED_DOT_COLOR]);
  });

  it("点は上限までしか出さない", () => {
    const many = PERSON_COLORS.map((c, i) => person(`p${i}`, `人${i}`, c.value, i + 1));
    const dots = collectPersonDotsInRange(
      [event({ date: "2026-09-10", personIds: many.map((p) => p.id!) })],
      many,
      "2026-09-01",
      "2026-09-30",
    );
    expect(dots.get("2026-09-10")).toHaveLength(MAX_DAY_DOTS);
  });

  it("またがる予定は、かかっている日すべてに色が付く", () => {
    const dots = collectPersonDotsInRange(
      [event({ date: "2026-09-10", endDate: "2026-09-12", personIds: ["p-wife"] })],
      people,
      "2026-09-01",
      "2026-09-30",
    );
    for (const date of ["2026-09-10", "2026-09-11", "2026-09-12"]) {
      expect(dots.get(date)).toEqual([personColorHex(wife)]);
    }
    expect(dots.get("2026-09-13")).toBeUndefined();
  });

  it("繰り返す予定は、表示中の枠のぶんだけ将来の回にも色が付く", () => {
    const dots = collectPersonDotsInRange(
      [event({ date: "2026-09-01", repeat: "weekly", personIds: ["p-me"] })],
      people,
      "2026-09-01",
      "2026-09-30",
    );
    expect([...dots.keys()].sort()).toEqual(["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);
  });

  it("枠の外の予定は数えない", () => {
    const dots = collectPersonDotsInRange(
      [event({ date: "2026-08-10", personIds: ["p-me"] })],
      people,
      "2026-09-01",
      "2026-09-30",
    );
    expect(dots.size).toBe(0);
  });
});
