import { describe, expect, it } from "vitest";
import { trimFixtures, trimStandings } from "../../api/soccer";

describe("api/soccer の絞り込み", () => {
  it("日程は、アプリが読む項目だけを残す", () => {
    const raw = {
      events: [
        {
          id: "1",
          date: "2026-11-01T16:30Z",
          name: "Liverpool vs Arsenal",
          season: { displayName: "2026-27 English Premier League", year: 2026 },
          seasonType: { name: "2026-27 English Premier League", id: "1" },
          links: [{ href: "x" }],
          competitions: [
            {
              timeValid: true,
              attendance: 0,
              venue: { fullName: "Anfield", address: { city: "Liverpool", country: "England" } },
              competitors: [
                { homeAway: "home", id: "364", winner: false, team: { id: "364", displayName: "Liverpool", logos: [1, 2, 3], links: [4] } },
                { homeAway: "away", id: "359", team: { id: "359", displayName: "Arsenal" } },
              ],
            },
          ],
        },
      ],
    };
    const out = trimFixtures(raw);
    expect(out.events[0]).toEqual({
      id: "1",
      date: "2026-11-01T16:30Z",
      season: { displayName: "2026-27 English Premier League" },
      seasonType: { name: "2026-27 English Premier League" },
      competitions: [
        {
          timeValid: true,
          venue: { fullName: "Anfield", address: { city: "Liverpool" } },
          competitors: [
            { homeAway: "home", id: "364", team: { id: "364", displayName: "Liverpool" } },
            { homeAway: "away", id: "359", team: { id: "359", displayName: "Arsenal" } },
          ],
        },
      ],
    });
  });

  it("日程が無い・壊れた応答でも落ちない", () => {
    expect(trimFixtures(null)).toEqual({ events: [] });
    expect(trimFixtures({})).toEqual({ events: [] });
  });

  it("順位表から、チームの id と名前だけを重複なく取る", () => {
    const out = trimStandings({
      children: [
        { standings: { entries: [{ team: { id: "1", displayName: "A", logos: [] }, stats: [1, 2] }, { team: { id: "2", displayName: "B" } }] } },
        { standings: { entries: [{ team: { id: "1", displayName: "A" } }] } },
      ],
    });
    expect(out.entries.map((e) => e.team)).toEqual([
      { id: "1", displayName: "A" },
      { id: "2", displayName: "B" },
    ]);
  });
});
