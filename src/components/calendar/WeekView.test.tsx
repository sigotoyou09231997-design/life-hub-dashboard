/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CalendarEvent, Task } from "../../types";
import { WeekView } from "./WeekView";

// 2026-10-14(水)を含む週 = 10/12(月)〜10/18(日)。
const ANCHOR = "2026-10-14";

function event(id: string, fields: Partial<CalendarEvent>): CalendarEvent {
  return { id, title: id, date: "2026-10-12", category: "other", createdAt: 1_000, ...fields };
}

function renderWeek(
  events: CalendarEvent[],
  over: Partial<Parameters<typeof WeekView>[0]> = {},
) {
  const handlers = {
    onAnchorChange: vi.fn(),
    onEditEvent: vi.fn(),
    onEditTask: vi.fn(),
    onAddEvent: vi.fn(),
  };
  render(<WeekView anchorDate={ANCHOR} events={events} people={[]} tasks={[]} {...handlers} {...over} />);
  return handlers;
}

/** 予定の箱(週の時刻の枠に置かれたボタン)を名前で探す。 */
function eventBox(title: string): HTMLElement {
  return screen.getByText(title, { selector: ".week-view__event strong" }).closest("button")!;
}

afterEach(cleanup);

describe("週表示", () => {
  it("選んだ日を含む、月曜はじまりの7日を並べる", () => {
    renderWeek([]);
    expect(screen.getByText("2026年10月12日〜18日")).toBeTruthy();
    const heads = [...document.querySelectorAll(".week-view__day-head .week-view__date")].map((el) => el.textContent);
    expect(heads).toEqual(["12", "13", "14", "15", "16", "17", "18"]);
  });

  it("時刻のある予定は、開始〜終了の位置に置く(ふだんの枠は8〜21時)", () => {
    renderWeek([event("定例", { date: "2026-10-13", startTime: "10:00", endTime: "11:00" })]);
    const box = eventBox("定例");
    // 8〜21時の13時間(780分)のうち、10時は上から120分、長さ60分。
    expect(parseFloat(box.style.top)).toBeCloseTo((120 / 780) * 100);
    expect(parseFloat(box.style.height)).toBeCloseTo((60 / 780) * 100);
    // 火曜(2列目)の列の中にある。
    const columns = [...document.querySelectorAll(".week-view__day")];
    expect(columns[1].contains(box)).toBe(true);
  });

  it("時間の重なる予定は、左右に半分ずつ並べる", () => {
    renderWeek([
      event("面談", { date: "2026-10-13", startTime: "13:00", endTime: "14:00" }),
      event("面接", { date: "2026-10-13", startTime: "13:30", endTime: "15:00" }),
    ]);
    expect(eventBox("面談").style.width).toBe("calc(50% - 4px)");
    expect(eventBox("面接").style.left).toBe("calc(50% + 2px)");
  });

  it("繰り返しの予定は、この週の回の日に出る", () => {
    renderWeek([event("ヨガ", { date: "2026-10-06", startTime: "07:00", endTime: "08:00", repeat: "weekly" })]);
    const columns = [...document.querySelectorAll(".week-view__day")];
    expect(columns[1].contains(eventBox("ヨガ"))).toBe(true);
  });

  it("何日かにまたがる予定・終日の予定は、上の帯にかかっている列をまたいで出す", () => {
    renderWeek([
      event("ホテル泊", { date: "2026-10-14", endDate: "2026-10-15", startTime: "15:00", endTime: "10:00" }),
      event("出張", { date: "2026-10-17", endDate: "2026-10-19", allDay: true }),
    ]);
    const stay = screen.getByRole("button", { name: "ホテル泊" });
    expect(stay.style.gridColumn).toBe("3 / 5");
    const trip = screen.getByRole("button", { name: "出張" });
    expect(trip.style.gridColumn).toBe("6 / 8");
    // 次の週へ続くので、その側の角を落とす印が付く。
    expect(trip.className).toContain("is-cont-after");
    // 時刻の枠には置かない。
    expect(document.querySelectorAll(".week-view__event")).toHaveLength(0);
  });

  it("期限のあるタスクも上の帯に出し、押すとタスクの編集を開く", () => {
    const task: Task = { id: "t1", title: "宿を予約", priority: "high", dueDate: "2026-10-15", completed: false, repeat: "none", createdAt: 1 };
    const done: Task = { ...task, id: "t2", title: "済んだこと", completed: true };
    const handlers = renderWeek([], { tasks: [task, done] });
    fireEvent.click(screen.getByRole("button", { name: /宿を予約/ }));
    expect(handlers.onEditTask).toHaveBeenCalledWith(task);
    expect(screen.queryByText("済んだこと")).toBeNull();
  });

  it("予定を押すと、その予定の編集を開く", () => {
    const meeting = event("定例", { date: "2026-10-12", startTime: "10:00", endTime: "11:00" });
    const handlers = renderWeek([meeting]);
    fireEvent.click(eventBox("定例"));
    expect(handlers.onEditEvent).toHaveBeenCalledWith(meeting);
  });

  it("空いている時刻を押すと、その日時で追加を開く(上の帯なら日付だけ)", () => {
    const handlers = renderWeek([]);
    fireEvent.click(screen.getByRole("button", { name: "10月13日(火) 14:30に予定を追加" }));
    expect(handlers.onAddEvent).toHaveBeenCalledWith("2026-10-13", "14:30");
    fireEvent.click(screen.getByRole("button", { name: "10月16日(金)に予定を追加" }));
    expect(handlers.onAddEvent).toHaveBeenLastCalledWith("2026-10-16");
  });

  it("前の週・次の週は、選んでいる日を7日ずらす(曜日はそのまま)", () => {
    const handlers = renderWeek([]);
    fireEvent.click(screen.getByRole("button", { name: "前の週" }));
    expect(handlers.onAnchorChange).toHaveBeenLastCalledWith("2026-10-07");
    fireEvent.click(screen.getByRole("button", { name: "次の週" }));
    expect(handlers.onAnchorChange).toHaveBeenLastCalledWith("2026-10-21");
  });
});

describe("週表示: サブスクのまとめと「今日から7日」(第8弾 S-2)", () => {
  it("同じ日の引き落とし(サブスク・固定費)が2件以上なら「引き落とし N件」の1本にまとめ、押すと内訳に開く", () => {
    const chips = new Map([
      ["2026-10-13", [
        { key: "s1", label: "Netflix", color: "#111", kind: "fixedCost" as const },
        { key: "s2", label: "Spotify", color: "#222", kind: "fixedCost" as const },
        { key: "s3", label: "iCloud", color: "#333", kind: "fixedCost" as const },
      ]],
      ["2026-10-15", [{ key: "s4", label: "家賃", color: "#444", kind: "fixedCost" as const }]],
    ]);
    renderWeek([], { fixedCostChips: chips });
    const group = screen.getByRole("button", { name: "引き落とし 3件" });
    expect(screen.queryByText("Netflix")).toBeNull();
    expect(screen.getByText("家賃")).toBeTruthy();
    fireEvent.click(group);
    expect(screen.getByText("Netflix")).toBeTruthy();
    expect(screen.getByText("iCloud")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "引き落とし 3件" })).toBeNull();
  });

  it("「今日から7日」を押すと、月曜はじまりではなくその日から7日になり、端末に覚える", () => {
    window.localStorage.removeItem("lifehub.weekViewRolling");
    const handlers = renderWeek([]);
    const firstDate = () => document.querySelector(".week-view__date")!.textContent;
    expect(firstDate()).toBe("12");
    const toggle = screen.getByRole("button", { name: "今日から7日" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("lifehub.weekViewRolling")).toBe("1");
    // 選んだ日(anchor)から7日。今日へ動かす呼び出しも1回出る。
    expect(firstDate()).toBe("14");
    expect(handlers.onAnchorChange).toHaveBeenCalledTimes(1);
    window.localStorage.removeItem("lifehub.weekViewRolling");
  });
});
