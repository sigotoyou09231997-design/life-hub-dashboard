/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TripScheduleItem } from "../../types";
import { TripDayRoute } from "./TripDayRoute";

const DAY = "2026-12-28";

function item(location: string | undefined, startTime: string): TripScheduleItem {
  return { id: `${location}${startTime}`, tripId: "t1", date: DAY, title: "x", location, startTime, type: "sightseeing", createdAt: 1 };
}

const ITEMS = [item("ホテル 徳島県徳島市", "07:00"), item("うだつの町並み 徳島県美馬市", "07:45"), item("桂浜 高知県高知市", "14:50")];

let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  open = vi.fn();
  vi.stubGlobal("open", open);
  try {
    window.localStorage.clear();
  } catch {
    // 触れない環境では既定のまま。
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TripDayRoute", () => {
  it("opens the day's route in Google Maps (by car by default)", () => {
    render(<TripDayRoute items={ITEMS} date={DAY} />);
    fireEvent.click(screen.getByRole("button", { name: "この日の経路をGoogleマップで開く" }));
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0];
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");
    const params = new URL(url).searchParams;
    expect(params.get("origin")).toBe("ホテル 徳島県徳島市");
    expect(params.get("destination")).toBe("桂浜 高知県高知市");
    expect(params.get("waypoints")).toBe("うだつの町並み 徳島県美馬市");
    expect(params.get("travelmode")).toBe("driving");
  });

  it("shows the places that will be routed, in order", () => {
    render(<TripDayRoute items={ITEMS} date={DAY} />);
    expect(screen.getByText("ホテル 徳島県徳島市 → うだつの町並み 徳島県美馬市 → 桂浜 高知県高知市")).toBeTruthy();
  });

  it("switches to walking and remembers the choice", () => {
    render(<TripDayRoute items={ITEMS} date={DAY} />);
    fireEvent.click(screen.getByRole("tab", { name: "徒歩" }));
    fireEvent.click(screen.getByRole("button", { name: "この日の経路をGoogleマップで開く" }));
    expect(new URL(open.mock.calls[0][0]).searchParams.get("travelmode")).toBe("walking");
    cleanup();
    render(<TripDayRoute items={ITEMS} date={DAY} />);
    expect(screen.getByRole("tab", { name: "徒歩" }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens a place search when the day has one place", () => {
    render(<TripDayRoute items={[ITEMS[0]]} date={DAY} />);
    fireEvent.click(screen.getByRole("button", { name: "この日の場所をGoogleマップで開く" }));
    expect(open.mock.calls[0][0]).toContain("/maps/search/");
  });

  it("leaves out a place the user unchecks (e.g. a train station) from the route", () => {
    const items = [item("小金井駅 栃木県下野市", "04:57"), item("東京駅 東京都千代田区", "06:48"), item("高松駅 香川県高松市", "11:18"), item("ニコニコレンタカー 香川県高松市", "12:10")];
    render(<TripDayRoute items={items} date={DAY} />);
    expect(screen.getByText("回る場所を選ぶ（4/4か所）")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "小金井駅 栃木県下野市" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "東京駅 東京都千代田区" }));
    expect(screen.getByText("回る場所を選ぶ（2/4か所）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "この日の経路をGoogleマップで開く" }));
    const params = new URL(open.mock.calls[0][0]).searchParams;
    expect(params.get("origin")).toBe("高松駅 香川県高松市");
    expect(params.get("destination")).toBe("ニコニコレンタカー 香川県高松市");
    expect(params.get("waypoints")).toBeNull();
  });

  it("tells the user when every place is unchecked", () => {
    render(<TripDayRoute items={[ITEMS[0], ITEMS[1]]} date={DAY} />);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(screen.queryByRole("button", { name: /Googleマップで開く/ })).toBeNull();
    expect(screen.getByText("回る場所が1つも選ばれていません。")).toBeTruthy();
  });

  it("treats a place that appears twice in a day as two separate checkboxes", () => {
    const twice = [item("桂浜 高知県", "14:50"), item("海津見神社 高知県", "15:35"), item("桂浜 高知県", "16:00")];
    render(<TripDayRoute items={twice} date={DAY} />);
    const boxes = screen.getAllByRole("checkbox", { name: "桂浜 高知県" });
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]);
    expect(screen.getByText("回る場所を選ぶ（2/3か所）")).toBeTruthy();
  });

  it("explains instead of showing a button when the day has no places", () => {
    render(<TripDayRoute items={[item(undefined, "09:00")]} date={DAY} />);
    expect(screen.queryByRole("button", { name: /Googleマップで開く/ })).toBeNull();
    expect(screen.getByText(/この日は場所の入った予定がありません/)).toBeTruthy();
  });

  it("offers one button per link when a long day is split", () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`場所${i}`, `${String(7 + i).padStart(2, "0")}:00`));
    render(<TripDayRoute items={many} date={DAY} />);
    expect(screen.getByRole("button", { name: /経路 1\/2 をGoogleマップで開く（11地点）/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /経路 2\/2 をGoogleマップで開く（2地点）/ })).toBeTruthy();
  });
});
