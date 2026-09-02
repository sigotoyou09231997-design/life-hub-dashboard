import { describe, expect, it } from "vitest";
import type { CalendarEvent, Note, SyncedEmail, Task, Trip, TripScheduleItem } from "../types";
import { countHits, searchEverything, type SearchSource } from "./globalSearch";

const event: CalendarEvent = {
  id: "e1",
  title: "歯医者",
  date: "2026-08-20",
  startTime: "10:00",
  location: "青葉デンタル",
  createdAt: 1,
};

const task: Task = {
  id: "t1",
  title: "青葉デンタルに電話する",
  priority: "medium",
  completed: false,
  repeat: "none",
  dueDate: "2026-08-18",
  createdAt: 1,
};

const note: Note = {
  id: "n1",
  type: "memo",
  title: "行きたい店",
  body: "駅前の青葉ベーカリー",
  tags: ["お出かけ"],
  pinned: false,
  createdAt: 1,
};

const trip: Trip = {
  id: "trip1",
  name: "夏の京都",
  destination: "京都",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  status: "planning",
  createdAt: 1,
};

const tripItem: TripScheduleItem = {
  id: "ts1",
  tripId: "trip1",
  date: "2026-09-02",
  title: "青葉庵で昼食",
  type: "meal",
  createdAt: 1,
};

const email: SyncedEmail = {
  id: "m1",
  accountId: "a1",
  gmailMessageId: "g1",
  threadId: "th1",
  from: "予約 <yoyaku@aoba.example.com>",
  subject: "青葉デンタル ご予約の確認",
  snippet: "ご予約ありがとうございます",
  receivedAt: 1,
  status: "unprocessed",
  createdAt: 1,
};

function source(overrides: Partial<SearchSource> = {}): SearchSource {
  return {
    events: [event],
    tasks: [task],
    notes: [note],
    trips: [trip],
    tripSchedule: [tripItem],
    emails: [email],
    ...overrides,
  };
}

describe("searchEverything", () => {
  it("returns nothing for an empty query", () => {
    expect(searchEverything("", source())).toEqual([]);
    expect(searchEverything("   ", source())).toEqual([]);
  });

  it("groups hits by the feature they came from", () => {
    const groups = searchEverything("青葉", source());
    expect(groups.map((g) => g.kind)).toEqual(["event", "task", "note", "tripSchedule", "email"]);
    expect(countHits(groups)).toBe(5);
  });

  it("keeps the group order stable regardless of which features matched", () => {
    const groups = searchEverything("京都", source());
    expect(groups.map((g) => g.kind)).toEqual(["trip"]);
    expect(groups[0].hits[0].title).toBe("夏の京都");
  });

  it("matches a note by its body, tags, and list items", () => {
    const checklist: Note = {
      id: "n2",
      type: "checklist",
      title: "持ち物",
      body: "",
      tags: [],
      pinned: false,
      checklistItems: [{ id: "c1", title: "充電ケーブル", checked: false }],
      createdAt: 1,
    };
    const hits = searchEverything("ケーブル", source({ notes: [checklist] }));
    expect(hits.map((g) => g.kind)).toEqual(["note"]);
    expect(hits[0].hits[0].title).toBe("持ち物");
  });

  it("ignores case for latin text", () => {
    const groups = searchEverything("AOBA", source());
    expect(groups.map((g) => g.kind)).toEqual(["email"]);
  });

  it("links each hit back to the screen that owns it", () => {
    const groups = searchEverything("青葉", source());
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.hits[0]]));
    expect(byKind.event.to).toBe("/schedule?view=list");
    expect(byKind.task.to).toBe("/schedule?view=list");
    expect(byKind.note.to).toBe("/records/notes");
    expect(byKind.tripSchedule.to).toBe("/trips/trip1?tab=schedule");
    expect(byKind.email.to).toBe("/gmail/mail/m1");
  });

  it("names the trip a schedule item belongs to", () => {
    const groups = searchEverything("青葉庵", source());
    expect(groups[0].hits[0].subtitle).toContain("夏の京都");
  });

  it("puts the newest dated hit first within a group", () => {
    const older = { ...event, id: "e2", date: "2026-07-01", title: "歯医者 予約" };
    const groups = searchEverything("歯医者", source({ events: [older, event] }));
    expect(groups[0].hits.map((h) => h.id)).toEqual(["e1", "e2"]);
  });

  it("caps each group so one noisy feature can't fill the sheet", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...task, id: `t${i}`, title: `青葉 ${i}` }));
    const groups = searchEverything("青葉", source({ tasks: many }));
    expect(groups.find((g) => g.kind === "task")!.hits).toHaveLength(8);
  });

  it("drops groups with no hits", () => {
    const groups = searchEverything("見つからない語", source());
    expect(groups).toEqual([]);
  });

  // 「誰の予定か」を付けたのに、探した結果の行に出ないと付いているか分からない
  // (2026-09-03の指摘)。名前ではなくidを渡し、出す側が引き当てる。
  it("予定の行は「誰の予定か」を持って出てくる", () => {
    const tagged = { ...event, personIds: ["p-me", "p-wife"] };
    const groups = searchEverything("歯医者", source({ events: [tagged] }));
    expect(groups.find((g) => g.kind === "event")!.hits[0].personIds).toEqual(["p-me", "p-wife"]);
  });

  it("印の無い予定の行には、誰も付いていないことが分かる形で出る", () => {
    const groups = searchEverything("歯医者", source());
    expect(groups.find((g) => g.kind === "event")!.hits[0].personIds).toBeUndefined();
  });
});
