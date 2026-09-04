import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  groupChangelogByDate,
  latestChangelogId,
  unreadChangelog,
  type ChangelogEntry,
} from "./changelog";

function entry(id: string, date: string): ChangelogEntry {
  return { id, date, area: "全体", title: id, description: "" };
}

describe("CHANGELOG そのもの", () => {
  it("idが重複していない(新着の判定がidを頼りにしているため)", () => {
    expect(new Set(CHANGELOG.map((e) => e.id)).size).toBe(CHANGELOG.length);
  });

  it("新しい日付が上に並んでいる", () => {
    const dates = CHANGELOG.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("いちばん新しい項目のidを返す", () => {
    expect(latestChangelogId()).toBe(CHANGELOG[0].id);
  });
});

describe("groupChangelogByDate", () => {
  it("同じ日をひとまとめにする", () => {
    const groups = groupChangelogByDate([
      entry("c", "2026-09-04"),
      entry("b", "2026-09-04"),
      entry("a", "2026-09-01"),
    ]);
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([
      ["2026-09-04", 2],
      ["2026-09-01", 1],
    ]);
  });
});

describe("unreadChangelog", () => {
  const entries = [entry("c", "2026-09-04"), entry("b", "2026-09-03"), entry("a", "2026-09-01")];

  it("覚えているidより新しいものが新着", () => {
    expect(unreadChangelog("a", entries).map((e) => e.id)).toEqual(["c", "b"]);
    expect(unreadChangelog("c", entries)).toEqual([]);
  });

  it("一度も開いていないときは、いちばん新しい1件だけを新着にする", () => {
    expect(unreadChangelog(null, entries).map((e) => e.id)).toEqual(["c"]);
  });

  it("覚えているidが見つからないときは新着なしにする", () => {
    expect(unreadChangelog("消えたid", entries)).toEqual([]);
  });

  it("履歴が空でも落ちない", () => {
    expect(unreadChangelog(null, [])).toEqual([]);
  });
});
