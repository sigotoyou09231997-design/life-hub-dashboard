/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CalendarEvent } from "../../types";
import { EventList } from "./EventList";

/** 9/27の10時に入って、9/29の11時に出る宿泊。 */
const stay: CalendarEvent = {
  id: "stay-1",
  title: "宿泊先",
  date: "2026-09-27",
  endDate: "2026-09-29",
  startTime: "10:00",
  endTime: "11:00",
  category: "other",
  createdAt: 1_000,
};

const oneDay: CalendarEvent = {
  id: "dentist-1",
  title: "歯医者",
  date: "2026-09-27",
  startTime: "10:00",
  endTime: "11:00",
  category: "other",
  createdAt: 1_000,
};

function renderList(events: CalendarEvent[], onDate?: string) {
  render(<EventList events={events} onEdit={() => {}} onDelete={() => {}} onDate={onDate} />);
}

afterEach(cleanup);

describe("またがる予定の見え方", () => {
  it("1日で終わる予定には、期間の但し書きを出さない", () => {
    renderList([oneDay], "2026-09-27");
    expect(screen.getByText("10:00〜11:00")).toBeTruthy();
    expect(screen.queryByText(/日目/)).toBeNull();
  });

  it("その日を見ている画面では、何日目かを出す", () => {
    renderList([stay], "2026-09-28");
    expect(screen.getByText("2日目/3日")).toBeTruthy();
  });

  it("間の日に開始時刻を出さない(毎日10時に何かある、と読ませない)", () => {
    renderList([stay], "2026-09-28");
    expect(screen.getByText("終日")).toBeTruthy();
    expect(screen.queryByText(/10:00/)).toBeNull();
  });

  it("初日は開始時刻だけ、最終日は終了時刻だけを出す", () => {
    renderList([stay], "2026-09-27");
    expect(screen.getByText("10:00〜")).toBeTruthy();
    cleanup();

    renderList([stay], "2026-09-29");
    expect(screen.getByText("〜11:00")).toBeTruthy();
  });

  it("日をまたいで並べる一覧(今後の予定)では、期間そのものを出す", () => {
    renderList([stay]);
    expect(screen.getByText("9/27(日)〜9/29(火)")).toBeTruthy();
    expect(screen.getByText("10:00〜11:00")).toBeTruthy();
  });
});
