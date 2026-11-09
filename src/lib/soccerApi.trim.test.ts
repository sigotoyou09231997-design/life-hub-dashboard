import { describe, expect, it } from "vitest";
import { mergeRecent, trimFixtures, trimStandings } from "../../api/soccer";

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

  it("直近36時間の終わった試合を足す。古い試合・同じ試合は足さない", () => {
    const now = Date.parse("2026-10-26T01:00:00Z");
    const ev = (id: string, date: string) => ({ id, date });
    const out = mergeRecent(
      { events: [ev("2", "2026-10-28T20:00Z"), ev("3", "2026-10-26T14:00Z")] },
      { events: [ev("1", "2026-10-25T17:30Z"), ev("0", "2026-10-20T20:00Z"), ev("3", "2026-10-26T14:00Z")] },
      now,
    );
    expect(out.events.map((e) => e.id)).toEqual(["1", "2", "3"]);
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

import { mergeNews, parseFeed, type NewsFeed } from "../../api/soccer";

describe("api/soccer の AIニュース", () => {
  const feed: NewsFeed = { id: "f", name: "F", lang: "en", official: true, url: "https://x/feed" };
  it("RSS から題名・リンク・日付・要約・写真を読む", () => {
    const xml = `<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://x/a</link><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>こんにちは <b>世界</b></p>]]></description><media:content medium="image" url="https://img/a"/></item>
      <item><title>no link</title></item></channel></rss>`;
    const items = parseFeed(xml, feed);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "A & B", url: "https://x/a", publishedAt: "2026-11-09T10:00:00.000Z", summary: "こんにちは 世界", image: "https://img/a" });
  });
  it("Atom も読み、http でないリンクは捨てる", () => {
    const xml = `<feed><entry><title>T</title><link href="https://x/t"/><updated>2026-11-09T10:00:00Z</updated></entry><entry><title>bad</title><link href="javascript:alert(1)"/></entry></feed>`;
    expect(parseFeed(xml, feed).map((i) => i.url)).toEqual(["https://x/t"]);
  });
  it("壊れた入力は空", () => {
    expect(parseFeed("<html>", feed)).toEqual([]);
  });
  it("新しい順・同じ記事は1つ・出どころごとに上限", () => {
    const mk = (n: number, id: string) => ({ title: String(n), url: `https://x/${id}${n}`, source: id, sourceId: id, lang: "en" as const, official: false, publishedAt: new Date(2026, 10, 1, n).toISOString() });
    const a = [1, 2, 3, 4].map((n) => mk(n, "a"));
    const b = [mk(0, "b")];
    const merged = mergeNews([a, b, [a[0]]], 10, 2);
    expect(merged.map((i) => i.url)).toEqual(["https://x/a4", "https://x/a3", "https://x/b0"]);
  });
});
