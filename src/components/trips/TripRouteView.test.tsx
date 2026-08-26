/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripRoutePlace } from "../../types";
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

function place(id: string, name: string, sortOrder: number): TripRoutePlace {
  return { id, tripId: "t1", name, address: `${name}の住所`, sortOrder, visited: false, createdAt: 1 };
}

const places = [place("p1", "岡山駅", 1), place("p2", "新横浜駅", 2)];

function renderView() {
  render(
    <TripRouteView
      tripId="t1"
      destination="横浜"
      places={places}
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
    expect(await screen.findByText("公共交通機関")).toBeTruthy();
    expect(screen.getByText("徒歩")).toBeTruthy();
    expect(screen.getByText("車")).toBeTruthy();
  });

  it("邪魔なときは畳める", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: "岡山駅から新横浜駅までの経路を閉じる" }));

    expect(screen.queryByText("岡山駅 → 新横浜駅")).toBeNull();
    expect(screen.getByRole("button", { name: "岡山駅から新横浜駅までの経路を見る" })).toBeTruthy();
  });
});
