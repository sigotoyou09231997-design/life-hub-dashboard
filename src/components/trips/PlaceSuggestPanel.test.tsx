/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import type { PlaceSuggestResult } from "../../lib/placeSuggestions";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }));
vi.mock("../../lib/placeSuggestions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/placeSuggestions")>("../../lib/placeSuggestions");
  return { ...actual, requestPlaceSuggestions: mocks.request };
});

import { PlaceSuggestPanel } from "./PlaceSuggestPanel";

const item = (location: string, id = location): TripScheduleItem => ({ id, tripId: "t1", date: "2026-12-27", title: id, location, type: "sightseeing", createdAt: 1 });
const route = (address: string): TripRoutePlace => ({ id: address, tripId: "t1", name: address, address, sortOrder: 1, visited: false, createdAt: 1 });

const RESULT: PlaceSuggestResult = {
  suggestions: [
    { from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }, { to: "霊山寺 奈良県奈良市" }], sure: false },
    { from: "児島駅", candidates: [{ to: "児島駅 岡山県倉敷市" }], sure: true },
  ],
  truncated: false,
  usage: { inputTokens: 1500, outputTokens: 700 },
};

function renderPanel(onUse = vi.fn(), schedule = [item("霊山寺"), item("児島駅"), item("昼食"), item("大麻比古神社 徳島県鳴門市")], routePlaces: TripRoutePlace[] = [route("霊山寺")]) {
  render(<PlaceSuggestPanel tripName="四国旅行" destination="四国" schedule={schedule} routePlaces={routePlaces} onUse={onUse} />);
  return onUse;
}

beforeEach(() => {
  mocks.request.mockReset();
});
afterEach(cleanup);

describe("PlaceSuggestPanel(AIの提案を選んで、対応表に入れる)", () => {
  it("名前だけの場所が無ければ、聞くボタンは出さない", () => {
    renderPanel(vi.fn(), [item("霊山寺 徳島県鳴門市")], []);
    expect(screen.getByText(/書かれていない場所は、ありません/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /AIに聞く/ })).toBeNull();
  });

  it("聞くと、旅行の名前・行き先・場所・手がかりを渡す。何を送るかと費用を、先に伝える", async () => {
    mocks.request.mockResolvedValue(RESULT);
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByText(/名前だけの場所が3件あります/)).toBeTruthy();
    expect(screen.getByText(/1回あたり数円/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "AIに聞く（3件）" }));
    expect(mocks.request).toHaveBeenCalledWith({
      tripName: "四国旅行",
      destination: "四国",
      places: ["霊山寺", "児島駅", "昼食"],
      context: ["大麻比古神社 徳島県鳴門市"],
    });
  });

  it("提案が出る: 1つに決まる場所は選ばれ、迷う場所は「要確認」で、選ぶまで入らない。入れるのは選んだものだけ", async () => {
    mocks.request.mockResolvedValue(RESULT);
    const user = userEvent.setup();
    const onUse = renderPanel();
    await user.click(screen.getByRole("button", { name: "AIに聞く（3件）" }));
    expect(await screen.findByText("要確認")).toBeTruthy();
    expect(screen.getByText("費用の目安: 約2円")).toBeTruthy();
    // 提案が来なかった場所は、そう言う。
    expect(screen.getByText(/提案できなかった場所（1件）: 昼食/)).toBeTruthy();
    expect(screen.getByText(/「要確認」の場所が1件、まだ選ばれていません/)).toBeTruthy();

    // 初めは sure の児島駅だけ。
    await user.click(screen.getByRole("button", { name: "選んだ内容を対応表に入れる（1件）" }));
    expect(onUse).toHaveBeenLastCalledWith("児島駅 → 児島駅 岡山県倉敷市");

    // 迷う霊山寺を、本人が選ぶ(2つ目の候補)。
    const radios = screen.getAllByRole("radio");
    const ryozen = radios.find((radio) => radio.closest("label")?.textContent === "霊山寺 奈良県奈良市")!;
    await user.click(ryozen);
    await user.click(screen.getByRole("button", { name: "選んだ内容を対応表に入れる（2件）" }));
    expect(onUse).toHaveBeenLastCalledWith("霊山寺 → 霊山寺 奈良県奈良市\n児島駅 → 児島駅 岡山県倉敷市");

    // 「変えない」に戻すと、その行は入らない。
    const keep = screen.getAllByRole("radio", { name: "変えない" })[0];
    await user.click(keep);
    await user.click(screen.getByRole("button", { name: "選んだ内容を対応表に入れる（1件）" }));
    expect(onUse).toHaveBeenLastCalledWith("児島駅 → 児島駅 岡山県倉敷市");
  });

  it("何も選ばれていなければ、入れるボタンは押せない", async () => {
    mocks.request.mockResolvedValue({ suggestions: [RESULT.suggestions[0]], truncated: false });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "AIに聞く（3件）" }));
    const button = (await screen.findByRole("button", { name: "選んだ内容を対応表に入れる（0件）" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("提案が1つも無ければ、そう言う。失敗した時は、理由を出して、もう一度聞ける", async () => {
    mocks.request.mockResolvedValueOnce({ suggestions: [], truncated: false });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "AIに聞く（3件）" }));
    expect(await screen.findByText("提案できる場所がありませんでした。")).toBeTruthy();

    mocks.request.mockRejectedValueOnce(new Error("AIの利用料金の残高が足りないようです"));
    await user.click(screen.getByRole("button", { name: "もう一度聞く" }));
    expect((await screen.findByRole("alert")).textContent).toContain("残高が足りない");
    await waitFor(() => expect(screen.getByRole("button", { name: "AIに聞く（3件）" })).toBeTruthy());
  });
});
