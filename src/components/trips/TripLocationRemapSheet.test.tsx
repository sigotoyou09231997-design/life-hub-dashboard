/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { ToastProvider } from "../ui/ToastProvider";
import { TripLocationRemapSheet } from "./TripLocationRemapSheet";

const mocks = vi.hoisted(() => ({
  scheduleUpdate: vi.fn(async () => 1),
  routeUpdate: vi.fn(async () => 1),
}));

vi.mock("../../db/schema", () => ({
  db: {
    tripSchedule: { update: mocks.scheduleUpdate },
    tripRoutePlaces: { update: mocks.routeUpdate },
    // トランザクションの中身(最後の引数)をそのまま走らせる。
    transaction: async (...args: unknown[]) => (args[args.length - 1] as () => Promise<void>)(),
  },
}));

function item(id: string, location: string | undefined): TripScheduleItem {
  return { id, tripId: "t1", date: "2026-12-27", title: id, location, type: "sightseeing", createdAt: 1 };
}

const SCHEDULE = [item("s1", "霊山寺"), item("s2", "霊山寺"), item("s3", "大麻比古神社")];
const ROUTE: TripRoutePlace[] = [
  { id: "r1", tripId: "t1", name: "霊山寺", address: "霊山寺", sortOrder: 1, visited: false, createdAt: 1 },
];

function renderSheet(onClose = () => {}) {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <TripLocationRemapSheet schedule={SCHEDULE} routePlaces={ROUTE} onClose={onClose} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

function paste(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}

afterEach(() => {
  cleanup();
  mocks.scheduleUpdate.mockClear();
  mocks.routeUpdate.mockClear();
});

describe("TripLocationRemapSheet", () => {
  it("previews how many schedule items and route places each line will change", () => {
    renderSheet();
    paste("霊山寺 → 霊山寺 徳島県鳴門市大麻町");
    expect(screen.getByText("日程2件・ルート1件")).toBeTruthy();
    expect(screen.getByRole("button", { name: "書き換える（日程2件・ルート1件）" })).toBeTruthy();
  });

  it("says so when a line matches nothing, and lists lines it skips", () => {
    renderSheet();
    paste("存在しない場所 → どこか\n自宅 → (載せない)");
    expect(screen.getByText("当たる場所がありません")).toBeTruthy();
    expect(screen.getByText(/2行目: 「載せない」は書き換えません/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /書き換える（/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rewrites only after the user confirms, then closes", async () => {
    const onClose = vi.fn();
    renderSheet(onClose);
    paste("霊山寺 → 霊山寺 徳島県鳴門市大麻町");
    fireEvent.click(screen.getByRole("button", { name: /書き換える（/ }));
    expect(mocks.scheduleUpdate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "書き換える" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.scheduleUpdate.mock.calls).toEqual([
      ["s1", { location: "霊山寺 徳島県鳴門市大麻町" }],
      ["s2", { location: "霊山寺 徳島県鳴門市大麻町" }],
    ]);
    expect(mocks.routeUpdate.mock.calls).toEqual([["r1", { address: "霊山寺 徳島県鳴門市大麻町" }]]);
  });

  it("changes nothing when the user cancels", async () => {
    const onClose = vi.fn();
    renderSheet(onClose);
    paste("霊山寺 → 霊山寺 徳島県鳴門市大麻町");
    fireEvent.click(screen.getByRole("button", { name: /書き換える（/ }));
    fireEvent.click(await screen.findByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "キャンセル" })).toBeNull());
    expect(mocks.scheduleUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
