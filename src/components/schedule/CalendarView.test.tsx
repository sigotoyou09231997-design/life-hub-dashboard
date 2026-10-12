/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CalendarEvent } from "../../types";
import { CalendarView } from "./CalendarView";
import { ConfirmProvider } from "../ui/ConfirmProvider";

const MONTH = new Date(2026, 8, 1); // 2026年9月

function eventOn(id: string, date: string, title = id): CalendarEvent {
  return { id, title, date, category: "other", createdAt: 1_000 };
}

function renderCalendar(
  events: CalendarEvent[],
  handlers: {
    onSelectDate?: (date: string) => void;
    onEditEvent?: (e: CalendarEvent) => void;
    onAddEvent?: (date: string) => void;
  } = {},
) {
  render(
    <CalendarView
      events={events}
      tasks={[]}
      tripAgenda={[]}
      currentMonth={MONTH}
      onMonthChange={() => {}}
      selectedDate="2026-09-01"
      onSelectDate={handlers.onSelectDate ?? (() => {})}
      onEditEvent={handlers.onEditEvent ?? (() => {})}
      onDeleteEvent={() => {}}
      onEditTask={() => {}}
      onAddSubtask={() => {}}
      onAddEvent={handlers.onAddEvent ?? (() => {})}
    />,
    { wrapper: ConfirmProvider },
  );
}

/** カレンダーのマス(日付の数字を含むボタン)をタップする。 */
function tapDay(day: string) {
  const cell = screen.getAllByText(day)[0].closest("button")!;
  fireEvent.click(cell);
}

/** 画面の幅(PC か スマホ か)。useIsDesktop は matchMedia を見るが、jsdom には無いので差し込む。 */
function stubDesktop(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  stubDesktop(false);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("カレンダーのマスをタップした時の動き", () => {
  it("予定が無い日をタップすると、その日を初期値にして追加フォームを開く", () => {
    const onAddEvent = vi.fn();
    const onEditEvent = vi.fn();
    const onSelectDate = vi.fn();
    renderCalendar([], { onAddEvent, onEditEvent, onSelectDate });

    tapDay("10");

    expect(onSelectDate).toHaveBeenCalledWith("2026-09-10");
    expect(onAddEvent).toHaveBeenCalledWith("2026-09-10");
    expect(onEditEvent).not.toHaveBeenCalled();
  });

  it("予定がちょうど1件の日をタップすると、その予定の編集フォームを開く", () => {
    const onAddEvent = vi.fn();
    const onEditEvent = vi.fn();
    const dentist = eventOn("dentist-1", "2026-09-12", "歯医者");
    renderCalendar([dentist], { onAddEvent, onEditEvent });

    tapDay("12");

    expect(onEditEvent).toHaveBeenCalledWith(dentist);
    expect(onAddEvent).not.toHaveBeenCalled();
  });

  it("予定が2件以上ある日をタップすると、その日の予定を並べたシートを出す", () => {
    const onAddEvent = vi.fn();
    const onEditEvent = vi.fn();
    const morning = eventOn("meeting-1", "2026-09-15", "打ち合わせ");
    const evening = eventOn("dinner-1", "2026-09-15", "夕食");
    renderCalendar([morning, evening], { onAddEvent, onEditEvent });

    tapDay("15");

    // どちらか一方を決めつけて開いたりせず、両方を選べる状態で並べる
    // (マスの中の帯にも同じ予定名が出るので、シート内の編集ボタンで確かめる)。
    expect(onEditEvent).not.toHaveBeenCalled();
    expect(onAddEvent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "打ち合わせを編集" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "夕食を編集" })).toBeTruthy();
  });

  it("2件以上ある日のシートで、1件を選ぶとその予定の編集フォームを開く", () => {
    const onEditEvent = vi.fn();
    const morning = eventOn("meeting-1", "2026-09-15", "打ち合わせ");
    const evening = eventOn("dinner-1", "2026-09-15", "夕食");
    renderCalendar([morning, evening], { onEditEvent });

    tapDay("15");
    fireEvent.click(screen.getByRole("button", { name: "夕食を編集" }));

    expect(onEditEvent).toHaveBeenCalledWith(evening);
  });

  it("2件以上ある日のシートからも、その日を初期値にして予定を追加できる", () => {
    const onAddEvent = vi.fn();
    const morning = eventOn("meeting-1", "2026-09-15", "打ち合わせ");
    const evening = eventOn("dinner-1", "2026-09-15", "夕食");
    renderCalendar([morning, evening], { onAddEvent });

    tapDay("15");
    fireEvent.click(screen.getByRole("button", { name: /この日に予定を追加/ }));

    expect(onAddEvent).toHaveBeenCalledWith("2026-09-15");
  });
});

describe("月/週の切り替え(PC幅だけ)", () => {
  it("PC幅では切り替えを出し、週を選ぶと週表示になって右の「その日の予定」は消える", () => {
    stubDesktop(true);
    renderCalendar([eventOn("dentist-1", "2026-09-01", "歯医者")]);

    expect(screen.getByRole("button", { name: "月", pressed: true })).toBeTruthy();
    expect(screen.getByText("9月1日(火)の予定")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "週" }));

    expect(screen.getByRole("button", { name: "週", pressed: true })).toBeTruthy();
    expect(document.querySelector(".week-view")).toBeTruthy();
    expect(screen.queryByText("9月1日(火)の予定")).toBeNull();
    // 選んだ見方は端末に覚える(次に開いた時も週のまま)。
    expect(window.localStorage.getItem("lifehub.calendarView")).toBe("week");
  });

  it("前に週を選んでいれば、開いた時から週表示", () => {
    stubDesktop(true);
    window.localStorage.setItem("lifehub.calendarView", "week");
    renderCalendar([]);
    expect(document.querySelector(".week-view")).toBeTruthy();
  });

  it("スマホでは、週を覚えていても月表示のまま(切り替えも出さない)", () => {
    window.localStorage.setItem("lifehub.calendarView", "week");
    renderCalendar([]);
    expect(document.querySelector(".week-view")).toBeNull();
    expect(screen.queryByRole("button", { name: "週" })).toBeNull();
  });

  it("週表示で時刻の枠を押すと、その日を選んで、時刻つきで追加を開く", () => {
    stubDesktop(true);
    window.localStorage.setItem("lifehub.calendarView", "week");
    const onAddEvent = vi.fn();
    const onSelectDate = vi.fn();
    renderCalendar([], { onAddEvent, onSelectDate });

    fireEvent.click(screen.getByRole("button", { name: "9月2日(水) 10:00に予定を追加" }));

    expect(onSelectDate).toHaveBeenCalledWith("2026-09-02");
    expect(onAddEvent).toHaveBeenCalledWith("2026-09-02", "10:00");
  });
});
