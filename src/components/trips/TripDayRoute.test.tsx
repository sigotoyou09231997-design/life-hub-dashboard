/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TripScheduleItem } from "../../types";
import { stopKeys } from "../../lib/tripDayRoute";
import { saveHomeAddress } from "../../lib/homePlace";
import { TripDayRoute } from "./TripDayRoute";

const DAY = "2026-12-27";

function item(location: string | undefined, startTime: string): TripScheduleItem {
  return { id: `${location}${startTime}`, tripId: "t1", date: DAY, title: "x", location, startTime, type: "sightseeing", createdAt: 1 };
}

/** 1日目の形: 電車で高松まで → 歩いてレンタカー店 → 車で回ってホテル。 */
const DAY1 = [
  item("小金井駅 栃木県下野市", "04:57"),
  item("東京駅 東京都千代田区", "06:48"),
  item("高松駅 香川県高松市", "11:18"),
  item("ニコニコレンタカー 香川県高松市", "12:10"),
  item("霊山寺 徳島県鳴門市", "13:30"),
  item("ホテル 徳島県徳島市", "17:30"),
];

let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  open = vi.fn();
  vi.stubGlobal("open", open);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openSheet(items = DAY1) {
  render(<TripDayRoute items={items} date={DAY} />);
  fireEvent.click(screen.getByRole("button", { name: "この日の経路を地図で見る" }));
}

function openedParams(call = 0) {
  return new URL(open.mock.calls[call][0]).searchParams;
}

/** シートの中の地図(埋め込み)が経路に入れている場所。saddr と daddr(+to: でつなぐ)を読み戻す。 */
function mapStops(): string[] {
  const src = screen.getByTitle(/の経路の地図$/).getAttribute("src")!;
  const params = new URL(src.replace(/\+to:/g, "%7Cto%7C")).searchParams;
  return [params.get("saddr")!, ...params.get("daddr")!.split("|to|")];
}

function mapSrc(): string {
  return screen.getByTitle(/の経路の地図$/).getAttribute("src")!;
}

/** 四国の札所を n か所。Googleマップを開くリンクの上限(11か所)を超える日の形。 */
function manyPlaces(n: number): TripScheduleItem[] {
  return Array.from({ length: n }, (_, i) => item(`第${i + 1}番札所 徳島県`, `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`));
}

describe("TripDayRoute", () => {
  it("does not open Google Maps until the user has chosen in the sheet", () => {
    openSheet();
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText(/チェックした場所を、全部つないで地図に出します/)).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("shows every checked place in one map, with no numbered buttons", () => {
    openSheet();
    expect(mapStops()).toEqual(DAY1.map((i) => i.location));
    expect(mapSrc()).toContain("dirflg=d");
    expect(screen.queryAllByRole("button", { name: /^\d+\. / })).toHaveLength(0);
  });

  it("puts more than 11 places into the one map (the Google Maps link stops at 11)", () => {
    openSheet(manyPlaces(20));
    expect(mapStops()).toHaveLength(20);
    expect(screen.queryByRole("button", { name: /Googleマップで開く/ })).toBeNull();
    expect(screen.getByText(/1本の経路に11か所までしか入らない/)).toBeTruthy();
  });

  it("leaves unchecked places out of the map and of the Google Maps link", () => {
    openSheet();
    fireEvent.click(screen.getByRole("checkbox", { name: "小金井駅 栃木県下野市" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "東京駅 東京都千代田区" }));
    expect(mapStops()).toEqual(DAY1.slice(2).map((i) => i.location));
    fireEvent.click(screen.getByRole("button", { name: "Googleマップで開く（車）" }));
    const p = openedParams();
    expect(p.get("origin")).toBe("高松駅 香川県高松市");
    expect(p.get("waypoints")).toBe("ニコニコレンタカー 香川県高松市|霊山寺 徳島県鳴門市");
    expect(p.get("travelmode")).toBe("driving");
    expect(open.mock.calls[0][1]).toBe("_blank");
  });

  it("uses one mode for the whole map, and explains that trains cannot be drawn as one line", () => {
    openSheet();
    fireEvent.click(screen.getByRole("tab", { name: "徒歩" }));
    expect(mapSrc()).toContain("dirflg=w");
    fireEvent.click(screen.getByRole("tab", { name: "電車・バス" }));
    expect(mapSrc()).toContain("dirflg=r");
    expect(screen.getByText(/3か所以上を1本の線でつなげない/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Googleマップで開く/ })).toBeNull();
  });

  it("opens a train search when only two places are left by train", () => {
    openSheet([DAY1[0], DAY1[1]]);
    fireEvent.click(screen.getByRole("tab", { name: "電車・バス" }));
    fireEvent.click(screen.getByRole("button", { name: "Googleマップで開く（電車・バス）" }));
    expect(openedParams().get("travelmode")).toBe("transit");
  });

  it("remembers unchecked places and the mode the next time", () => {
    openSheet();
    fireEvent.click(screen.getByRole("checkbox", { name: "小金井駅 栃木県下野市" }));
    fireEvent.click(screen.getByRole("tab", { name: "徒歩" }));
    cleanup();
    openSheet();
    expect((screen.getByRole("checkbox", { name: "小金井駅 栃木県下野市" }) as HTMLInputElement).checked).toBe(false);
    expect(mapSrc()).toContain("dirflg=w");
  });

  it("still reads the places left out before, when the old choices also held leg modes", () => {
    const [koganeiKey] = stopKeys(DAY, [DAY1[0].location!]);
    window.localStorage.setItem("lifehub.tripDayRouteChoices", JSON.stringify({ legs: { x: "transit" }, excluded: [koganeiKey] }));
    openSheet();
    expect((screen.getByRole("checkbox", { name: "小金井駅 栃木県下野市" }) as HTMLInputElement).checked).toBe(false);
    expect(mapStops()).toEqual(DAY1.slice(1).map((i) => i.location));
  });

  it("treats a place that appears twice in a day as two separate checkboxes", () => {
    openSheet([item("桂浜 高知県", "14:50"), item("海津見神社 高知県", "15:35"), item("桂浜 高知県", "16:00")]);
    const boxes = screen.getAllByRole("checkbox", { name: "桂浜 高知県" });
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]);
    expect((screen.getAllByRole("checkbox", { name: "桂浜 高知県" })[0] as HTMLInputElement).checked).toBe(true);
    expect((screen.getAllByRole("checkbox", { name: "桂浜 高知県" })[1] as HTMLInputElement).checked).toBe(false);
  });

  it("says so when every place is unchecked", () => {
    openSheet([DAY1[0], DAY1[1]]);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(screen.queryByTitle(/の経路の地図$/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Googleマップで開く/ })).toBeNull();
    expect(screen.getByText("地図に出す場所が1つも選ばれていません。")).toBeTruthy();
  });

  it("opens a place search when only one place is chosen", () => {
    openSheet([DAY1[0], DAY1[1]]);
    fireEvent.click(screen.getByRole("checkbox", { name: "東京駅 東京都千代田区" }));
    fireEvent.click(screen.getByRole("button", { name: "Googleマップで場所を開く" }));
    expect(open.mock.calls[0][0]).toContain("/maps/search/");
  });

  it("explains instead of showing a button when the day has no places", () => {
    render(<TripDayRoute items={[item(undefined, "09:00")]} date={DAY} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/この日は場所の入った予定がありません/)).toBeTruthy();
  });

  // 「自宅」をそのまま Google マップに渡すと、名前の似たお店(「お家サロン」)に当たっていた(2026-10-12)。
  it("leaves 自宅 out of the map and says how to add it when no home address is set", () => {
    render(
      <MemoryRouter>
        <TripDayRoute items={[item("自宅", "05:00"), ...DAY1.slice(1, 3)]} date={DAY} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "この日の経路を地図で見る" }));
    expect(mapStops()).toEqual(["東京駅 東京都千代田区", "高松駅 香川県高松市"]);
    expect(screen.queryByRole("checkbox", { name: "自宅" })).toBeNull();
    expect(screen.getByRole("link", { name: "自宅の住所を入れる" }).getAttribute("href")).toBe("/settings");
  });

  it("「あとで」で案内を閉じると、この端末では次に開いても出ない(仕上げ B-2)", () => {
    const props = { items: [item("自宅", "05:00"), ...DAY1.slice(1, 3)], date: DAY };
    const { unmount } = render(
      <MemoryRouter>
        <TripDayRoute {...props} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "この日の経路を地図で見る" }));
    fireEvent.click(screen.getByRole("button", { name: "あとで" }));
    expect(screen.queryByRole("link", { name: "自宅の住所を入れる" })).toBeNull();
    expect(window.localStorage.getItem("lifehub.tripDayRouteHomeNoteDismissed")).toBe("1");
    unmount();
    render(
      <MemoryRouter>
        <TripDayRoute {...props} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "この日の経路を地図で見る" }));
    expect(screen.queryByRole("link", { name: "自宅の住所を入れる" })).toBeNull();
    // 「自宅」そのものは今までどおり地図に入れない。
    expect(mapStops()).toEqual(["東京駅 東京都千代田区", "高松駅 香川県高松市"]);
  });

  it("uses the home address from the settings in place of 自宅", () => {
    saveHomeAddress("栃木県下野市1-2-3");
    render(
      <MemoryRouter>
        <TripDayRoute items={[item("自宅", "05:00"), ...DAY1.slice(1, 3)]} date={DAY} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "この日の経路を地図で見る" }));
    expect(mapStops()).toEqual(["栃木県下野市1-2-3", "東京駅 東京都千代田区", "高松駅 香川県高松市"]);
    expect(screen.queryByRole("link", { name: "自宅の住所を入れる" })).toBeNull();
  });
});

describe("経路の手段は、日程の移動手段を基本にする(2026-10-14)", () => {
  const move = (location: string, startTime: string, transportMode: TripScheduleItem["transportMode"]): TripScheduleItem => ({
    ...item(location, startTime),
    type: "transport",
    transportMode,
  });
  const withTrain = [move("高松駅 香川県高松市", "08:00", "train"), item("栗林公園 香川県高松市", "10:00"), item("高松港 香川県高松市", "12:00")];
  const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

  it("その日の移動の予定が電車なら「電車・バス」、車なら「車」、歩きなら「徒歩」を選んでおく。理由を一言添える", () => {
    openSheet(withTrain);
    expect(mapSrc()).toContain("dirflg=r");
    expect(selectedTab()).toBe("電車・バス");
    expect(screen.getByText("日程の移動手段（電車・バス）に合わせています。")).toBeTruthy();

    cleanup();
    openSheet([move("高松駅 香川県高松市", "08:00", "car"), item("栗林公園 香川県高松市", "10:00")]);
    expect(mapSrc()).toContain("dirflg=d");
    expect(screen.getByText("日程の移動手段（車）に合わせています。")).toBeTruthy();

    cleanup();
    openSheet([move("高松駅 香川県高松市", "08:00", "walk"), item("栗林公園 香川県高松市", "10:00")]);
    expect(mapSrc()).toContain("dirflg=w");
  });

  it("日程に移動手段が無い日は、これまでどおり(最後に選んだ手段、無ければ車)。理由の一言も出さない", () => {
    openSheet(DAY1);
    expect(mapSrc()).toContain("dirflg=d");
    expect(screen.queryByText(/日程の移動手段/)).toBeNull();
  });

  it("本人が選び直した手段は、日程の手段より先。「日程に合わせる」で、日程の手段に戻せる", () => {
    openSheet(withTrain);
    fireEvent.click(screen.getByRole("tab", { name: "車" }));
    expect(mapSrc()).toContain("dirflg=d");
    expect(screen.getByText(/日程の移動手段は電車・バスです/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "日程に合わせる" }));
    expect(mapSrc()).toContain("dirflg=r");
    expect(screen.getByText("日程の移動手段（電車・バス）に合わせています。")).toBeTruthy();
  });

  it("選び直した手段は、その日だけのもの。次に開いた時も覚えている(日ごとに別)", () => {
    openSheet(withTrain);
    fireEvent.click(screen.getByRole("tab", { name: "徒歩" }));
    cleanup();
    openSheet(withTrain);
    expect(mapSrc()).toContain("dirflg=w");
    // 別の日(日程に移動手段が無い日)は、最後に選んだ手段(徒歩)がそのまま使われる。
    cleanup();
    render(<TripDayRoute items={[{ ...item("A 徳島県", "08:00"), date: "2026-12-28" }, { ...item("B 徳島県", "09:00"), date: "2026-12-28" }]} date="2026-12-28" />);
    fireEvent.click(screen.getByRole("button", { name: "この日の経路を地図で見る" }));
    expect(mapSrc()).toContain("dirflg=w");
  });
});
