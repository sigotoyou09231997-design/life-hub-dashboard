/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomeWeekStrip } from "./HomeWeekStrip";
import type { StripDay, UpcomingRow } from "../../lib/homeLayout";

afterEach(cleanup);

const days: StripDay[] = [];

function renderStrip(rows: UpcomingRow[]) {
  render(
    <MemoryRouter>
      <HomeWeekStrip days={days} rows={rows} ready onAdd={() => {}} />
    </MemoryRouter>,
  );
}

describe("ホーム「今日と、この先」の参加ボタン(2026-11-26)", () => {
  it("会議のリンクがある予定の行に「参加」を出し、行そのもの(カレンダーへ)とは別に押せる", () => {
    renderStrip([
      {
        key: "e:iv:2026-11-26",
        kind: "event",
        date: "2026-11-26",
        time: "19:30",
        title: "サイバーコム 面接",
        meeting: { url: "https://zoom.us/j/123", service: "Zoom" },
      },
      { key: "e:dentist:2026-11-26", kind: "event", date: "2026-11-26", time: "18:30", title: "歯医者" },
    ]);
    const join = screen.getByRole("link", { name: /Zoomで参加/ });
    expect(join.getAttribute("href")).toBe("https://zoom.us/j/123");
    expect(join.textContent).toContain("参加");
    // 行のリンク(カレンダーへ)はそのまま残る
    const rowLink = screen.getByRole("link", { name: /サイバーコム 面接/ });
    expect(rowLink.getAttribute("href")).toBe("/schedule?view=calendar&date=2026-11-26");
    // <a> の中に <a> を入れない
    expect(rowLink.contains(join)).toBe(false);
    // リンクの無い行には出さない
    expect(screen.getAllByRole("link", { name: /で参加/ })).toHaveLength(1);
  });
});
