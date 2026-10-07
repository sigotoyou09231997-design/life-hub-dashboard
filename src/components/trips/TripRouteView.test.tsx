/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import type { RouteSuggestion } from "../../lib/tripRouteSuggestions";
import { TripRouteView } from "./TripRouteView";
import { ConfirmProvider } from "../ui/ConfirmProvider";

vi.mock("../../db/schema", () => ({
  db: { tripRoutePlaces: { update: async () => {} } },
}));

// 所要時間はサーバー(Googleのキー)頼みなので、ここでは呼ばせない。
// 「キーが無くても移動手段の行は出す」のが本来の作りなので configured: false で十分。
const routeInfo = vi.hoisted(() => ({
  fetch: async (_origin: string, _destination: string): Promise<unknown> => ({ configured: false }),
}));
vi.mock("../../lib/routeInfo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/routeInfo")>()),
  fetchRouteInfo: (origin: string, destination: string) => routeInfo.fetch(origin, destination),
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
    // 削除の確認はアプリ内のシートで聞くので、その土台ごと描く。
    { wrapper: ConfirmProvider },
  );
}

afterEach(() => {
  cleanup();
  // 「時間で見る」を選ぶと端末に覚えるので、次のテストへ持ち越さない。
  window.localStorage.clear();
  routeInfo.fetch = async () => ({ configured: false });
});

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
      { wrapper: ConfirmProvider },
    );

    // 既定は1日目(「すべて」は置いていない — その日に回る順として読めないため)。
    expect(screen.queryByRole("button", { name: "すべて" })).toBeNull();
    expect(await screen.findByTitle("岡山駅の地図")).toBeTruthy();
    expect(screen.queryByTitle("新横浜駅の地図")).toBeNull();

    await user.click(screen.getByRole("button", { name: /2日目/ }));

    expect(screen.queryByTitle("岡山駅の地図")).toBeNull();
    expect(screen.getByTitle("新横浜駅の地図")).toBeTruthy();
  });

  it("どの場所にも日付が付いていなければ、「日付なし」から始める", async () => {
    // 1日目に寄せると開いた瞬間が空になり、入れた場所が消えたように見える。
    render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={[place("p1", "宿泊先", 1)]}
        dayList={["2026-09-19", "2026-09-20"]}
        suggestions={[]}
        onAddSuggestions={() => {}}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
      { wrapper: ConfirmProvider },
    );

    expect(await screen.findByTitle("宿泊先の地図")).toBeTruthy();
    expect(screen.getByRole("button", { name: /日付なし/ }).getAttribute("aria-pressed")).toBe("true");
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
      { wrapper: ConfirmProvider },
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
      { wrapper: ConfirmProvider },
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

describe("旅行のルート: 時間で見る", () => {
  const day = "2026-09-19";
  const dayPlaces = [
    place("p1", "岡山駅", 1, day),
    place("p2", "新横浜駅", 2, day),
    place("p3", "ホテル", 3, day),
  ];
  const item = (title: string, location: string, startTime?: string, endTime?: string): TripScheduleItem => ({
    id: title,
    tripId: "t1",
    date: day,
    title,
    location,
    startTime,
    endTime,
    type: "transport",
    createdAt: 1,
  });
  const schedule = [
    item("のぞみ 岡山→新横浜", "岡山駅の住所", "09:00", "11:10"),
    item("チェックイン", "ホテルの住所", "15:00"),
  ];

  function renderTime() {
    return render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={dayPlaces}
        dayList={[day, "2026-09-20"]}
        schedule={schedule}
        suggestions={[]}
        onAddSuggestions={() => {}}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
      { wrapper: ConfirmProvider },
    );
  }

  it("既定は地図。押すと、時刻つきの縦の並びに変わる", async () => {
    const user = userEvent.setup();
    renderTime();

    expect(screen.getByRole("button", { name: "地図で見る" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTitle("岡山駅の地図")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "時間で見る" }));

    // 地図は出さず、日程の時刻を場所に付けて、回る順に並べる。
    expect(screen.queryByTitle("岡山駅の地図")).toBeNull();
    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.getByText("〜11:10")).toBeTruthy();
    expect(screen.getByText("のぞみ 岡山→新横浜")).toBeTruthy();
    expect(screen.getByText("15:00")).toBeTruthy();
    // 日程に無い場所も、時刻なしで残る(消えない)。
    expect(screen.getByText("新横浜駅")).toBeTruthy();
    expect(screen.getByText("時刻なし")).toBeTruthy();
  });

  it("選んだ見方は覚えていて、開き直しても時間で見る", async () => {
    const user = userEvent.setup();
    const first = renderTime();
    await user.click(screen.getByRole("button", { name: "時間で見る" }));
    first.unmount();

    renderTime();

    expect(screen.getByRole("button", { name: "時間で見る" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTitle("岡山駅の地図")).toBeNull();
  });

  it("日程の住所が場所の住所と同じ時だけ時刻が付く(ここでは場所の住所は「〜の住所」)", async () => {
    const user = userEvent.setup();
    renderTime();
    await user.click(screen.getByRole("button", { name: "時間で見る" }));

    // place() は住所を「<名前>の住所」にしてある。のぞみ→岡山駅の住所、チェックイン→ホテルの住所。
    const times = screen.getAllByText(/^\d\d:\d\d$/).map((el) => el.textContent);
    expect(times).toEqual(["09:00", "15:00"]);
  });

  it("移動時間が取れた時は、場所のあいだに手段つきで出し、時刻が空の場所には着く目安を出す", async () => {
    routeInfo.fetch = async (origin: string) => ({
      configured: true,
      modes: {
        walking: { unavailable: true },
        transit: origin === "岡山駅の住所" ? { durationSeconds: 35 * 60 } : { durationSeconds: 20 * 60 },
        driving: { unavailable: true },
      },
    });
    const user = userEvent.setup();
    renderTime();
    await user.click(screen.getByRole("button", { name: "時間で見る" }));

    // 岡山駅(〜11:10)→新横浜駅(時刻なし): 11:10 + 35分。
    expect(await screen.findByText(/公共交通機関 35分/)).toBeTruthy();
    expect(screen.getByText(/11:45ごろ着/)).toBeTruthy();
    // 新横浜駅は終了時刻が無いので、そのあとの目安は出さない。ホテルには自前の時刻がある。
    expect(screen.getByText(/公共交通機関 20分/)).toBeTruthy();
    expect(screen.queryByText(/ごろ着.*ごろ着/)).toBeNull();
  });

  it("移動が次の予定に間に合わなそうなら、そう書く", async () => {
    routeInfo.fetch = async () => ({
      configured: true,
      modes: { walking: { unavailable: true }, transit: { durationSeconds: 60 * 60 }, driving: { unavailable: true } },
    });
    const tight: TripScheduleItem[] = [
      item("朝食", "岡山駅の住所", "08:00", "09:00"),
      item("会議", "新横浜駅の住所", "09:30"),
    ];
    const user = userEvent.setup();
    render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={dayPlaces.slice(0, 2)}
        dayList={[day, "2026-09-20"]}
        schedule={tight}
        suggestions={[]}
        onAddSuggestions={() => {}}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
      { wrapper: ConfirmProvider },
    );
    await user.click(screen.getByRole("button", { name: "時間で見る" }));

    expect(await screen.findByText("時間が足りないかもしれません")).toBeTruthy();
    expect(screen.getByText(/次の予定まで30分/)).toBeTruthy();
  });

  it("経路が取れない(キー未設定など)時も、時刻の並びはそのまま出る", async () => {
    routeInfo.fetch = async () => ({ configured: true, modes: { walking: { unavailable: true }, transit: { unavailable: true }, driving: { unavailable: true } } });
    const user = userEvent.setup();
    renderTime();
    await user.click(screen.getByRole("button", { name: "時間で見る" }));

    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.queryByText(/公共交通機関 \d/)).toBeNull();
  });
});

