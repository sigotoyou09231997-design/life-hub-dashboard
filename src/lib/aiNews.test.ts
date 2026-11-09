import { describe, expect, it } from "vitest";
import { filterNews, pickHomeNews, timeAgoJa, type AiNewsItem } from "./aiNews";

const item = (over: Partial<AiNewsItem>): AiNewsItem => ({
  title: "t", url: `https://x/${Math.random()}`, source: "S", sourceId: "s", lang: "en", official: false, ...over,
});

describe("AIニュース", () => {
  it("絞り込み: 日本語と公式の発表", () => {
    const a = item({ lang: "ja" });
    const b = item({ official: true });
    const c = item({});
    expect(filterNews([a, b, c], "ja")).toEqual([a]);
    expect(filterNews([a, b, c], "official")).toEqual([b]);
    expect(filterNews([a, b, c], "all")).toHaveLength(3);
  });

  it("ホームの3枚は、最新の日本語・最新の公式・その他の最新を、新しい順で", () => {
    const t1 = item({ title: "新しい英語" });
    const t2 = item({ title: "2番目の英語" });
    const ja = item({ title: "日本語", lang: "ja" });
    const off = item({ title: "公式", official: true });
    const picks = pickHomeNews([t1, t2, ja, off]);
    expect(picks.map((i) => i.title)).toEqual(["新しい英語", "日本語", "公式"]);
  });

  it("ホームの3枚: 記事が少なくても出せる", () => {
    expect(pickHomeNews([])).toEqual([]);
    const only = item({});
    expect(pickHomeNews([only])).toEqual([only]);
  });

  it("経過時間の言い方", () => {
    const now = Date.parse("2026-11-10T12:00:00+09:00");
    expect(timeAgoJa("2026-11-10T11:30:00+09:00", now)).toBe("30分前");
    expect(timeAgoJa("2026-11-10T09:00:00+09:00", now)).toBe("3時間前");
    expect(timeAgoJa("2026-11-09T09:00:00+09:00", now)).toBe("昨日");
    expect(timeAgoJa(undefined, now)).toBe("");
  });
});
