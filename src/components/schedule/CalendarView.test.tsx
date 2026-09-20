/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(cleanup);

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
