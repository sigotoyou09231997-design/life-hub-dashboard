/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NearestStationResponse } from "../../lib/nearestStation";
import { buildFromHereSearchUrl, type TravelMode } from "../../lib/googleMaps";
import { TripLegRoute } from "./TripLegRoute";

// 所要時間はサーバー(Googleのキー)頼み。ここでは呼ばせず、行だけ出る形で確かめる。
vi.mock("../../lib/routeInfo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/routeInfo")>()),
  fetchRouteInfo: async () => ({ configured: false }),
}));

const station: NearestStationResponse = {
  configured: true,
  station: { name: "長谷駅", address: "神奈川県鎌倉市長谷1丁目" },
  walk: { durationSeconds: 420, distanceMeters: 600 },
};
let answer: NearestStationResponse = station;

vi.mock("../../lib/nearestStation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/nearestStation")>()),
  fetchNearestStation: async () => answer,
}));

function renderLeg(mode: TravelMode = "transit", onModeChange = () => {}) {
  render(
    <TripLegRoute
      origin="35.681236,139.767125"
      originLabel="現在地"
      destination="6-10-1 Sakanoshita, 鎌倉市, 神奈川県 248-0021, 日本"
      destinationLabel="宿泊先"
      mode={mode}
      onModeChange={onModeChange}
      mapClassName="trip-route-card__map"
      buildOpenUrl={(to, m) => buildFromHereSearchUrl(to, m)}
      openLabel="現在地からの案内をGoogleマップで開く"
      mapFirst
    />,
  );
}

afterEach(() => {
  answer = station;
  cleanup();
});

describe("区間を駅で分けて見せる", () => {
  it("公共交通機関なら「現在地 → 駅」と「駅 → 行き先」に分ける", async () => {
    renderLeg();

    expect(await screen.findByTitle("現在地から長谷駅までの経路")).toBeTruthy();
    expect(screen.getByText("徒歩7分(600m)")).toBeTruthy();
    // 分けた後は、1本だけの経路は出さない。
    expect(screen.queryByTitle("現在地から宿泊先までの経路")).toBeNull();
  });

  it("駅からの徒歩の地図は、押した時だけ読み込む", async () => {
    const user = userEvent.setup();
    renderLeg();

    await user.click(await screen.findByText("徒歩7分(600m)"));

    expect(screen.getByTitle("長谷駅から宿泊先までの徒歩の経路")).toBeTruthy();
  });

  it("「直行」を押すと、これまでどおり1本の経路に戻る", async () => {
    const user = userEvent.setup();
    renderLeg();

    await user.click(await screen.findByText("直行"));

    expect(screen.getByTitle("現在地から宿泊先までの経路")).toBeTruthy();
    expect(screen.queryByTitle("現在地から長谷駅までの経路")).toBeNull();
  });

  it("車や徒歩では分けない(駅で乗り換えないため)", async () => {
    renderLeg("driving");

    expect(await screen.findByTitle("現在地から宿泊先までの経路")).toBeTruthy();
    expect(screen.queryByText("長谷駅を経由")).toBeNull();
  });

  it("駅が取れない時は、切り替え自体を出さない", async () => {
    answer = { configured: false };
    renderLeg();

    expect(await screen.findByTitle("現在地から宿泊先までの経路")).toBeTruthy();
    expect(screen.queryByText("直行")).toBeNull();
  });
});
