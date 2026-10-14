/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { ToastProvider } from "../ui/ToastProvider";
import { TripLocationRemapSheet } from "./TripLocationRemapSheet";

const mocks = vi.hoisted(() => ({
  scheduleUpdate: vi.fn(async () => 1),
  routeUpdate: vi.fn(async () => 1),
  request: vi.fn(),
}));

// AI の提案(src/lib/placeSuggestions.ts)は別のテストで見る。ここでは、選んだ行が対応表に入るところだけ見る。
vi.mock("../../lib/supabase", () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }));
vi.mock("../../lib/placeSuggestions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/placeSuggestions")>("../../lib/placeSuggestions");
  return { ...actual, requestPlaceSuggestions: mocks.request };
});

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
  mocks.request.mockReset();
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

describe("AI の提案を対応表に入れる(2026-10-14)", () => {
  it("選んだ行が対応表に入り、何件に当たるかが出る。書き換えは、そのあと本人が押した時だけ", async () => {
    mocks.request.mockResolvedValue({
      suggestions: [{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }], sure: true }],
      truncated: false,
    });
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: /AIに聞く/ }));
    await user.click(await screen.findByRole("button", { name: "選んだ内容を対応表に入れる（1件）" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("霊山寺 → 霊山寺 徳島県鳴門市");
    expect(screen.getByText("日程2件・ルート1件")).toBeTruthy();
    // まだ書き換えていない。
    expect(mocks.scheduleUpdate).not.toHaveBeenCalled();
    expect(mocks.routeUpdate).not.toHaveBeenCalled();
  });

  it("すでに対応表にある行は残し、同じ元の場所は新しい行に置き換える。コメント行も残す", async () => {
    mocks.request.mockResolvedValue({
      suggestions: [{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }], sure: true }],
      truncated: false,
    });
    const user = userEvent.setup();
    renderSheet();
    paste("# 四国\n大麻比古神社 → 大麻比古神社 徳島県鳴門市\n霊山寺 → 霊山寺 奈良県奈良市");
    await user.click(screen.getByRole("button", { name: /AIに聞く/ }));
    await user.click(await screen.findByRole("button", { name: "選んだ内容を対応表に入れる（1件）" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "# 四国\n大麻比古神社 → 大麻比古神社 徳島県鳴門市\n霊山寺 → 霊山寺 徳島県鳴門市",
    );
  });
});
