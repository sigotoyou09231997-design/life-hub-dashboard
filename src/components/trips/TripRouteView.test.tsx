/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripRoutePlace } from "../../types";
import type { RouteSuggestion } from "../../lib/tripRouteSuggestions";
import { TripRouteView } from "./TripRouteView";

vi.mock("../../db/schema", () => ({
  db: { tripRoutePlaces: { update: async () => {} } },
}));

// 所要時間はサーバー(Googleのキー)頼みなので、ここでは呼ばせない。
// 「キーが無くても移動手段の行は出す」のが本来の作りなので configured: false で十分。
vi.mock("../../lib/routeInfo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/routeInfo")>()),
  fetchRouteInfo: async () => ({ configured: false }),
}));

function place(id: string, name: string, sortOrder: number, date?: string): TripRoutePlace {
  return { id, tripId: "t1", name, address: `${name}の住所`, sortOrder, date, visited: false, createdAt: 1 };
}

const places = [place("p1", "岡山駅", 1), place("p2", "新横浜駅", 2), place("p3", "東京駅", 3)];

function renderView() {
  render(
    <TripRouteView
      tripId="t1"
      destination="横浜"
      places={places}
      dayList={["2026-09-19", "2026-09-20"]}
      suggestions={[]}
      onAddSuggestions={() => {}}
      onAdd={() => {}}
      onFirstSaved={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("旅行のルート", () => {
  it("場所と場所の間の経路を、押さなくても最初から出す", async () => {
    renderView();

    expect(screen.getByText("岡山駅 → 新横浜駅")).toBeTruthy();
    expect(screen.getByTitle("岡山駅から新横浜駅までの経路")).toBeTruthy();
    // 移動手段もいつも通り出る(所要時間が出ない時も行そのものは残す作り)。
    expect((await screen.findAllByText("公共交通機関")).length).toBe(2);
    expect(screen.getAllByText("徒歩").length).toBe(2);
    expect(screen.getAllByText("車").length).toBe(2);
  });

  it("移動手段は区間ごとに切り替わる", async () => {
    const user = userEvent.setup();
    renderView();

    const leg1 = () => screen.getByTitle("岡山駅から新横浜駅までの経路") as HTMLIFrameElement;
    const leg2 = () => screen.getByTitle("新横浜駅から東京駅までの経路") as HTMLIFrameElement;
    // dirflg は埋め込み地図の移動手段(r=乗換案内, d=車)。
    expect(leg1().src).toContain("dirflg=r");

    const cars = await screen.findAllByText("車");
    await user.click(cars[0]);

    expect(leg1().src).toContain("dirflg=d");
    // つられて変わらないことがこのテストの本題。
    expect(leg2().src).toContain("dirflg=r");
  });

  it("日にちで絞ると、その日の場所だけ並ぶ", async () => {
    const user = userEvent.setup();
    render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={[place("p1", "岡山駅", 1, "2026-09-19"), place("p2", "新横浜駅", 2, "2026-09-20")]}
        dayList={["2026-09-19", "2026-09-20"]}
        suggestions={[]}
        onAddSuggestions={() => {}}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    // 既定は「すべて」。日付を決めていない場所も含めて今まで通り並ぶ。
    expect(screen.getByTitle("岡山駅の地図")).toBeTruthy();
    expect(screen.getByTitle("新横浜駅の地図")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /2日目/ }));

    expect(screen.queryByTitle("岡山駅の地図")).toBeNull();
    expect(screen.getByTitle("新横浜駅の地図")).toBeTruthy();
  });

  it("その日のルートが空でも、日程に入っている場所を候補に出す", async () => {
    const user = userEvent.setup();
    const added: RouteSuggestion[][] = [];
    const suggestion: RouteSuggestion = {
      scheduleId: "s1",
      date: "2026-09-19",
      startTime: "09:30",
      name: "岡山駅",
      address: "岡山駅",
      memo: "新幹線 岡山→新横浜",
      title: "新幹線 岡山→新横浜",
      type: "transport",
    };
    render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={[place("p2", "新横浜駅", 1, "2026-09-20")]}
        dayList={["2026-09-19", "2026-09-20"]}
        suggestions={[suggestion]}
        onAddSuggestions={(picked) => added.push(picked)}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /1日目/ }));

    // ルートの1日目は0件でも、日程の新幹線がここに出る。
    expect(screen.getByText("日程に入っている場所")).toBeTruthy();
    expect(screen.getByText("岡山駅")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "入れる" }));
    expect(added).toEqual([[suggestion]]);
  });

  it("候補はその日のぶんだけ出す", async () => {
    const user = userEvent.setup();
    const suggestion = (id: string, name: string, date: string): RouteSuggestion => ({
      scheduleId: id,
      date,
      name,
      address: name,
      title: name,
      type: "sightseeing",
    });
    render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={[place("p1", "岡山駅", 1, "2026-09-19")]}
        dayList={["2026-09-19", "2026-09-20"]}
        suggestions={[suggestion("s1", "鶴岡八幡宮", "2026-09-19"), suggestion("s2", "江ノ島", "2026-09-20")]}
        onAddSuggestions={() => {}}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /2日目/ }));

    expect(screen.getByText("江ノ島")).toBeTruthy();
    expect(screen.queryByText("鶴岡八幡宮")).toBeNull();
  });

  it("邪魔なときは畳める", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: "岡山駅から新横浜駅までの経路を閉じる" }));

    expect(screen.queryByText("岡山駅 → 新横浜駅")).toBeNull();
    expect(screen.getByRole("button", { name: "岡山駅から新横浜駅までの経路を見る" })).toBeTruthy();
  });
});
