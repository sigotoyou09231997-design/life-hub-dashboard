import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../types";

const mocks = vi.hoisted(() => ({ events: new Map<string, CalendarEvent>() }));

vi.mock("../db/schema", () => ({
  db: {
    calendarEvents: {
      put: async (row: CalendarEvent) => void mocks.events.set(row.id!, row),
      delete: async (id: string) => void mocks.events.delete(id),
      toArray: async () => [...mocks.events.values()],
      where: () => ({ aboveOrEqual: (from: string) => ({ toArray: async () => [...mocks.events.values()].filter((e) => e.date >= from) }) }),
    },
  },
}));

import { competitionNameJa, teamNameJa } from "./soccerTeamNames";
import {
  fetchLeagueTeams,
  fixtureToEventFields,
  isTargetCompetition,
  isUnextFullCoverage,
  removeAllSoccerEvents,
  shouldAutoSyncSoccer,
  syncSoccerFixtures,
  toJst,
  type EspnFixture,
} from "./soccerFixtures";

function fixture(id: string, date: string, season = "2026-27 English Premier League", extra: Partial<EspnFixture> = {}): EspnFixture {
  return {
    id,
    date,
    season: { displayName: season },
    seasonType: { name: season },
    competitions: [
      {
        timeValid: true,
        venue: { fullName: "Emirates Stadium", address: { city: "London" } },
        competitors: [
          { homeAway: "home", team: { id: "359", displayName: "Arsenal" } },
          { homeAway: "away", team: { id: "364", displayName: "Liverpool" } },
        ],
      },
    ],
    ...extra,
  };
}

const NOW = Date.parse("2026-10-25T00:00:00Z");
const ok = (events: EspnFixture[]) => ({ ok: true, json: async () => ({ events }) });

describe("toJst", () => {
  it("UTC の夜の試合は日本時間で翌日の早朝になる", () => {
    expect(toJst("2026-11-01T16:30Z")).toEqual({ date: "2026-11-02", time: "01:30" });
    expect(toJst("2026-10-24T14:00Z")).toEqual({ date: "2026-10-24", time: "23:00" });
  });
  it("読めない時刻は null", () => {
    expect(toJst("not a date")).toBeNull();
  });
});

describe("isTargetCompetition", () => {
  it("リーグ戦と UEFA の大会は入れる", () => {
    expect(isTargetCompetition("2026-27 English Premier League")).toBe(true);
    expect(isTargetCompetition("2026-27 Spanish LaLiga")).toBe(true);
    expect(isTargetCompetition("2026-27 UEFA Champions League")).toBe(true);
    expect(isTargetCompetition("2026-27 UEFA Europa League")).toBe(true);
  });
  it("国内カップ・スーパーカップ・親善試合は入れない", () => {
    for (const name of ["2026-27 English Carabao Cup", "English FA Cup", "Copa del Rey", "DFB Pokal", "UEFA Super Cup", "Club Friendly"]) {
      expect(isTargetCompetition(name)).toBe(false);
    }
  });
});

describe("日本語の名前", () => {
  it("チーム名・大会名を日本語にし、知らない名前はそのまま出す", () => {
    expect(teamNameJa("Paris Saint-Germain")).toBe("パリ・サンジェルマン");
    expect(teamNameJa("Some New FC")).toBe("Some New FC");
    expect(competitionNameJa("UEFA Champions League")).toBe("UEFAチャンピオンズリーグ");
    expect(competitionNameJa("League Phase")).toBe("リーグフェーズ");
    expect(competitionNameJa("Unknown Cup")).toBe("Unknown Cup");
  });
  it("予定の題名とメモが日本語になる", () => {
    const f = fixtureToEventFields(fixture("2", "2026-11-04T20:00Z", "2026-27 UEFA Champions League", { seasonType: { name: "League Phase" } }));
    expect(f?.title).toBe("⚽ アーセナル vs リバプール");
    expect(f?.memo).toContain("UEFAチャンピオンズリーグ リーグフェーズ");
  });
});

describe("メモの大会名", () => {
  it("「Regular Season」は書かない", () => {
    const f = fixtureToEventFields(fixture("3", "2026-11-04T20:00Z", "2026-27 Dutch Eredivisie", { seasonType: { name: "Regular Season" } }));
    expect(f?.memo?.split("\n")[0]).toBe("エールディヴィジ");
  });
});

describe("U-NEXT の配信", () => {
  it("プレミアリーグとラ・リーガ1部だけに書く", () => {
    expect(isUnextFullCoverage("2026-27 English Premier League")).toBe(true);
    expect(isUnextFullCoverage("2026-27 LALIGA")).toBe(true);
    expect(isUnextFullCoverage("Spanish LALIGA")).toBe(true);
    for (const name of ["2026-27 UEFA Champions League", "2026-27 UEFA Europa League", "English League Championship", "Spanish LALIGA 2", "2026-27 German Bundesliga"]) {
      expect(isUnextFullCoverage(name)).toBe(false);
    }
  });
  it("予定のメモに配信先が入る。CL には入らない", () => {
    expect(fixtureToEventFields(fixture("1", "2026-11-01T16:30Z"))?.memo).toContain("U-NEXT");
    expect(fixtureToEventFields(fixture("2", "2026-11-04T20:00Z", "2026-27 UEFA Champions League"))?.memo).not.toContain("U-NEXT");
  });
});

describe("fixtureToEventFields", () => {
  it("日本時間の予定にして、元の試合を見分ける印をメモに残す", () => {
    const f = fixtureToEventFields(fixture("401", "2026-11-01T16:30Z"));
    expect(f).toMatchObject({
      title: "⚽ アーセナル vs リバプール",
      date: "2026-11-02",
      startTime: "01:30",
      location: "Emirates Stadium、London",
      category: "other",
    });
    expect(f?.memo).toContain("ESPN#401 (359-364)");
    expect(f?.allDay).toBeUndefined();
  });
  it("時刻が決まっていない試合は終日にする", () => {
    const base = fixture("402", "2026-11-01T00:00Z");
    base.competitions![0].timeValid = false;
    const f = fixtureToEventFields(base);
    expect(f?.allDay).toBe(true);
    expect(f?.startTime).toBeUndefined();
    expect(f?.memo).toContain("未定");
  });
  it("カップ戦は取り込まない", () => {
    expect(fixtureToEventFields(fixture("403", "2026-10-27T20:00Z", "2026-27 English Carabao Cup"))).toBeNull();
  });
});

describe("syncSoccerFixtures", () => {
  const arsenal = { id: "359", name: "Arsenal", league: "プレミアリーグ" };
  beforeEach(() => mocks.events.clear());

  it("今後の試合を足し、同じ試合は何度やっても1件のまま", async () => {
    const f = ok([fixture("1", "2026-11-01T16:30Z"), fixture("2", "2026-11-08T15:00Z")]);
    const r1 = await syncSoccerFixtures([arsenal], NOW, async () => f);
    expect(r1).toMatchObject({ added: 2, updated: 0, removed: 0 });
    const r2 = await syncSoccerFixtures([arsenal], NOW, async () => f);
    expect(r2).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(mocks.events.size).toBe(2);
  });

  it("2チームが当たる試合は1件になる", async () => {
    const same = ok([fixture("1", "2026-11-01T16:30Z")]);
    await syncSoccerFixtures([arsenal, { id: "364", name: "Liverpool", league: "プレミアリーグ" }], NOW, async () => same);
    expect(mocks.events.size).toBe(1);
  });

  it("日程が動いたら同じ予定を直す(前の時刻は残さない)", async () => {
    await syncSoccerFixtures([arsenal], NOW, async () => ok([fixture("1", "2026-11-01T16:30Z")]));
    const moved = fixture("1", "2026-11-03T00:00Z");
    moved.competitions![0].timeValid = false;
    const r = await syncSoccerFixtures([arsenal], NOW, async () => ok([moved]));
    expect(r.updated).toBe(1);
    const [event] = [...mocks.events.values()];
    expect(event.date).toBe("2026-11-03");
    expect(event.allDay).toBe(true);
    expect(event.startTime).toBeUndefined();
  });

  it("日程から消えた試合は予定からも消す。過ぎた試合と自分で作った予定は触らない", async () => {
    mocks.events.set("mine", { id: "mine", title: "歯医者", date: "2026-11-02", createdAt: 1 });
    mocks.events.set("past", { id: "past", title: "⚽ old", date: "2026-10-01", memo: "ESPN#9", createdAt: 1 });
    await syncSoccerFixtures([arsenal], NOW, async () => ok([fixture("1", "2026-11-01T16:30Z")]));
    const r = await syncSoccerFixtures([arsenal], NOW, async () => ok([]));
    expect(r.removed).toBe(1);
    expect([...mocks.events.keys()].sort()).toEqual(["mine", "past"]);
  });

  it("1チームでも取れなかった時は何も消さない", async () => {
    await syncSoccerFixtures([arsenal], NOW, async () => ok([fixture("1", "2026-11-01T16:30Z")]));
    const r = await syncSoccerFixtures([arsenal], NOW, async () => ({ ok: false, json: async () => ({}) }));
    expect(r).toMatchObject({ failedTeams: 1, removed: 0 });
    expect(mocks.events.size).toBe(1);
  });
});

describe("そのほか", () => {
  beforeEach(() => mocks.events.clear());

  it("全部外した時は今後の試合だけを消す", async () => {
    mocks.events.set("a", { id: "a", title: "⚽ x", date: "2026-11-01", memo: "ESPN#1", createdAt: 1 });
    mocks.events.set("b", { id: "b", title: "⚽ y", date: "2026-10-01", memo: "ESPN#2", createdAt: 1 });
    expect(await removeAllSoccerEvents(NOW)).toBe(1);
    expect([...mocks.events.keys()]).toEqual(["b"]);
  });

  it("チーム一覧を名前順に読む", async () => {
    let url = "";
    const teams = await fetchLeagueTeams("eng.1", async (u) => {
      url = u;
      return {
      ok: true,
      json: async () => ({
        children: [{ standings: { entries: [{ team: { id: "2", displayName: "Burnley" } }, { team: { id: "1", displayName: "Arsenal" } }] } }],
      }),
      };
    });
    expect(teams.map((t) => t.name)).toEqual(["アーセナル", "バーンリー"]);
    expect(url).toBe("/api/soccer?kind=teams&value=eng.1");
    expect(teams[0].league).toContain("プレミアリーグ");
  });

  it("自動の取り込みは、チームを選んでいて6時間以上たっている時だけ", () => {
    const team = { id: "1", name: "A", league: "L" };
    expect(shouldAutoSyncSoccer([], 0, NOW)).toBe(false);
    expect(shouldAutoSyncSoccer([team], NOW - 60_000, NOW)).toBe(false);
    expect(shouldAutoSyncSoccer([team], NOW - 7 * 3600_000, NOW)).toBe(true);
  });
});
