/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripRoutePlace, TripScheduleItem } from "../../types";
import type { RouteSuggestion } from "../../lib/tripRouteSuggestions";
import { TripRouteView } from "./TripRouteView";
import { ConfirmProvider } from "../ui/ConfirmProvider";

const dbCalls = vi.hoisted(() => ({ updates: [] as [string, unknown][] }));
vi.mock("../../db/schema", () => ({
  db: { tripRoutePlaces: { update: async (id: string, patch: unknown) => void dbCalls.updates.push([id, patch]) } },
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
  dbCalls.updates = [];
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

describe("日程の場所を押して来た時", () => {
  it("その場所の日に切り替え、その場所まで送って光らせる", async () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.dataset.routePlace ?? "");
    };
    try {
      render(
        <TripRouteView
          tripId="t1"
          destination="松山"
          places={[place("p1", "松山駅", 1, "2026-09-19"), place("p2", "道後温泉", 2, "2026-09-20"), place("p3", "ダイワロイネットホテル松山", 3, "2026-09-20")]}
          focus={{ id: "p3", at: 1 }}
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
      // 1日目ではなく、その場所のある2日目が開く。
      expect(await screen.findByTitle("ダイワロイネットホテル松山の地図")).toBeTruthy();
      expect(screen.queryByTitle("松山駅の地図")).toBeNull();
      expect(screen.getByRole("button", { name: /2日目/ }).getAttribute("aria-pressed")).toBe("true");
      expect(scrolled).toContain("p3");
      const card = document.querySelector('[data-route-place="p3"]')!;
      expect(card.className).toContain("trip-route-card--match");
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe("旅行のルート: 候補を選んで入れる(要望「候補がいくつかあるなら選択させて」)", () => {
  const sug = (id: string, name: string): RouteSuggestion => ({ scheduleId: id, date: "2026-09-19", startTime: "09:30", name, address: name, memo: "", title: `${name}へ`, type: "transport" });
  const three = [sug("s1", "岡山駅"), sug("s2", "高松駅"), sug("s3", "丸亀城")];

  function renderPicks(suggestions: RouteSuggestion[], onAdd: (picked: RouteSuggestion[]) => void) {
    render(
      <TripRouteView
        tripId="t1"
        destination="香川"
        places={[place("p9", "既にある場所", 1, "2026-09-19")]}
        dayList={["2026-09-19", "2026-09-20"]}
        suggestions={suggestions}
        onAddSuggestions={onAdd}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
      { wrapper: ConfirmProvider },
    );
  }

  it("候補が2つ以上ある時、それぞれにチェックが付く。選んだものだけをルートに入れられる", async () => {
    const user = userEvent.setup();
    const added: RouteSuggestion[][] = [];
    renderPicks(three, (picked) => added.push(picked));
    await user.click(screen.getByRole("button", { name: /1日目/ }));

    // 何も選んでいない間は、これまでどおり「すべてルートに入れる」
    expect(screen.getByRole("button", { name: "すべてルートに入れる" })).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: "岡山駅を選ぶ" }));
    await user.click(screen.getByRole("checkbox", { name: "丸亀城を選ぶ" }));
    expect(screen.queryByRole("button", { name: "すべてルートに入れる" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "選んだ2件をルートに入れる" }));
    expect(added).toEqual([[three[0], three[2]]]);
    // 入れたあとは、選びを空に戻す
    expect((screen.getByRole("checkbox", { name: "岡山駅を選ぶ" }) as HTMLInputElement).checked).toBe(false);
  });

  it("「すべて選ぶ」で全部にチェックが付き、もう一度押すと外れる。1件ずつの「入れる」も残る", async () => {
    const user = userEvent.setup();
    const added: RouteSuggestion[][] = [];
    renderPicks(three, (picked) => added.push(picked));
    await user.click(screen.getByRole("button", { name: /1日目/ }));
    await user.click(screen.getByRole("button", { name: "すべて選ぶ" }));
    expect(screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked && box.getAttribute("aria-label")?.endsWith("を選ぶ"))).toHaveLength(3);
    expect(screen.getByRole("button", { name: "選んだ3件をルートに入れる" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "選びをやめる" }));
    expect(screen.getByRole("button", { name: "すべてルートに入れる" })).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "入れる" })[1]);
    expect(added).toEqual([[three[1]]]);
  });

  it("候補が1つだけの時は、チェックは出さない(「入れる」だけ)", async () => {
    const user = userEvent.setup();
    renderPicks([three[0]], () => {});
    await user.click(screen.getByRole("button", { name: /1日目/ }));
    expect(screen.queryByRole("checkbox", { name: /を選ぶ/ })).toBeNull();
    expect(screen.getByRole("button", { name: "入れる" })).toBeTruthy();
  });
});

describe("旅行のルート: 地図に出す場所を選ぶ", () => {
  it("2つ以上あれば、選ぶ一覧を開ける。外した場所は地図(鎖)から消え、件数が変わる。ルートには残る", async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.getByText("3/3件を表示中")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /地図に出す場所を選ぶ/ }));
    await user.click(screen.getByRole("checkbox", { name: "新横浜駅を地図に出す" }));

    expect(screen.getByText("2/3件を表示中")).toBeTruthy();
    // 鎖に出ているのは、選んだ場所だけ。区間は、残った場所のあいだでつなぎ直る。
    expect(screen.getByText("岡山駅 → 東京駅")).toBeTruthy();
    expect(screen.queryByText("岡山駅 → 新横浜駅")).toBeNull();
    // 外した場所も、選ぶ一覧には残る(戻せる)
    expect((screen.getByRole("checkbox", { name: "新横浜駅を地図に出す" }) as HTMLInputElement).checked).toBe(false);
    // 「全地点をGoogleマップで開く」には、選んだ場所だけを渡す
    const link = screen.getByRole("link", { name: /全地点をGoogleマップで開く/ });
    const href = decodeURIComponent(link.getAttribute("href") ?? "");
    expect(href).toContain("岡山駅の住所");
    expect(href).toContain("東京駅の住所");
    expect(href).not.toContain("新横浜駅の住所");
  });

  it("選びはこの端末に覚えていて、開き直しても外したまま。「すべて表示する」で戻る", async () => {
    const user = userEvent.setup();
    const { unmount } = (() => {
      renderView();
      return { unmount: cleanup };
    })();
    await user.click(screen.getByRole("button", { name: /地図に出す場所を選ぶ/ }));
    await user.click(screen.getByRole("checkbox", { name: "岡山駅を地図に出す" }));
    unmount();

    renderView();
    expect(screen.getByText("2/3件を表示中")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /地図に出す場所を選ぶ/ }));
    await user.click(screen.getByRole("button", { name: "すべて表示する" }));
    expect(screen.getByText("3/3件を表示中")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("lifeHubRouteHidden:t1") ?? "[]")).toEqual([]);
  });

  it("全部外すと、その旨と「すべて表示する」を出す(空の画面にしない)", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /地図に出す場所を選ぶ/ }));
    for (const name of ["岡山駅", "新横浜駅", "東京駅"]) await user.click(screen.getByRole("checkbox", { name: `${name}を地図に出す` }));
    expect(screen.getByText(/地図に出す場所が選ばれていません/)).toBeTruthy();
    expect(screen.queryByText("この日に回る場所はまだ入っていません。")).toBeNull();
    const buttons = screen.getAllByRole("button", { name: "すべて表示する" });
    await user.click(buttons[0]);
    expect(screen.getByText("3/3件を表示中")).toBeTruthy();
  });

  it("場所が1つだけの日には、選ぶ一覧を出さない", () => {
    render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={[place("p1", "岡山駅", 1)]}
        dayList={["2026-09-19"]}
        suggestions={[]}
        onAddSuggestions={() => {}}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
      { wrapper: ConfirmProvider },
    );
    expect(screen.queryByRole("button", { name: /地図に出す場所を選ぶ/ })).toBeNull();
  });

  it("時間で見る方にも、外した場所は出さない", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /地図に出す場所を選ぶ/ }));
    await user.click(screen.getByRole("checkbox", { name: "東京駅を地図に出す" }));
    await user.click(screen.getByRole("button", { name: "時間で見る" }));
    // 選ぶ一覧には外した場所も残る(戻せるように)ので、時間の並びの中だけを見る。
    const timeline = document.querySelector<HTMLElement>(".trip-route__time")!;
    expect(within(timeline).queryByText("東京駅")).toBeNull();
    expect(within(timeline).getByText("岡山駅")).toBeTruthy();
  });
});


describe("区間の移動手段は、日程の移動手段を基本にする(2026-10-14)", () => {
  const DAY1 = "2026-09-19";
  const dayPlaces = [place("p1", "岡山駅", 1, DAY1), place("p2", "新横浜駅", 2, DAY1), place("p3", "東京駅", 3, DAY1)];
  const move = (location: string, startTime: string, transportMode: TripScheduleItem["transportMode"]): TripScheduleItem => ({
    id: `${location}${startTime}`,
    tripId: "t1",
    date: DAY1,
    title: "移動",
    location,
    startTime,
    type: "transport",
    transportMode,
    createdAt: 1,
  });

  function renderWith(schedule: TripScheduleItem[]) {
    render(
      <TripRouteView
        tripId="t1"
        destination="横浜"
        places={dayPlaces}
        dayList={[DAY1, "2026-09-20"]}
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
  const leg1 = () => (screen.getByTitle("岡山駅から新横浜駅までの経路") as HTMLIFrameElement).src;
  const leg2 = () => (screen.getByTitle("新横浜駅から東京駅までの経路") as HTMLIFrameElement).src;

  it("その区間の始点から出る移動の予定の手段を、最初から選んでおく。ほかの区間は、その日のいちばん多い手段", async () => {
    // 岡山駅から出る移動は車。新横浜駅から出る移動は無いので、その日で多い手段(車2・徒歩1 → 車)。
    renderWith([move("岡山駅の住所", "08:00", "car"), move("どこか", "09:00", "car"), move("あそこ", "10:00", "walk")]);
    await screen.findAllByText("公共交通機関");
    expect(leg1()).toContain("dirflg=d");
    expect(leg2()).toContain("dirflg=d");
  });

  it("区間ごとに違う手段が日程にあれば、区間ごとに違う手段になる", () => {
    renderWith([move("岡山駅の住所", "08:00", "train"), move("新横浜駅の住所", "10:00", "walk")]);
    expect(leg1()).toContain("dirflg=r");
    expect(leg2()).toContain("dirflg=w");
  });

  it("日程に移動手段が無ければ、これまでどおり公共交通機関", () => {
    renderWith([]);
    expect(leg1()).toContain("dirflg=r");
    expect(leg2()).toContain("dirflg=r");
  });

  it("本人が選び直した区間は、日程の手段より先。ほかの区間はつられない", async () => {
    const user = userEvent.setup();
    renderWith([move("岡山駅の住所", "08:00", "car"), move("新横浜駅の住所", "10:00", "car")]);
    expect(leg1()).toContain("dirflg=d");
    const walks = await screen.findAllByText("徒歩");
    await user.click(walks[0]);
    expect(leg1()).toContain("dirflg=w");
    expect(leg2()).toContain("dirflg=d");
  });
});

describe("日程に住所が入っているのに、ルートの場所が名前のままの時(2026-10-14)", () => {
  const DAY1 = "2026-09-19";
  const ADDRESS = "徳島県鳴門市大麻町板東塚鼻126";
  const named = [{ ...place("p1", "霊山寺", 1, DAY1), address: "霊山寺" }, place("p2", "児島駅", 2, DAY1)];
  const schedule: TripScheduleItem[] = [
    { id: "s1", tripId: "t1", date: DAY1, title: "霊山寺", location: "霊山寺", address: ADDRESS, type: "sightseeing", createdAt: 1 },
  ];

  function renderWith(items: TripScheduleItem[], routePlaces = named) {
    render(
      <TripRouteView
        tripId="t1"
        destination="四国"
        places={routePlaces}
        dayList={[DAY1, "2026-09-20"]}
        schedule={items}
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

  it("知らせを出し、押すと、ルートの場所の住所を日程の住所に直す(押すまでは何も書き換えない)", async () => {
    const user = userEvent.setup();
    renderWith(schedule);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("日程に住所が入っている場所が1件あります");
    expect(dbCalls.updates).toEqual([]);

    await user.click(screen.getByRole("button", { name: "日程の住所を反映" }));
    expect(dbCalls.updates).toEqual([["p1", { address: ADDRESS }]]);
  });

  it("反映するものが無ければ、知らせは出さない", () => {
    renderWith([{ ...schedule[0], address: undefined }]);
    expect(screen.queryByRole("button", { name: "日程の住所を反映" })).toBeNull();
  });
});

describe("ルートの場所から、元になった日程を開く(2026-10-14)", () => {
  const DAY1 = "2026-09-19";
  const spots = [{ ...place("p1", "霊山寺", 1, DAY1), address: "霊山寺" }, { ...place("p2", "どこにも無い場所", 2, DAY1), address: "どこにも無い場所" }];
  const source: TripScheduleItem = { id: "s1", tripId: "t1", date: DAY1, title: "霊山寺", location: "霊山寺", startTime: "09:00", type: "sightseeing", createdAt: 1 };

  function renderWith(onOpenSchedule?: (item: TripScheduleItem) => void) {
    render(
      <TripRouteView
        tripId="t1"
        destination="四国"
        places={spots}
        dayList={[DAY1, "2026-09-20"]}
        schedule={[source]}
        suggestions={[]}
        onAddSuggestions={() => {}}
        onAdd={() => {}}
        onFirstSaved={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onOpenSchedule={onOpenSchedule}
      />,
      { wrapper: ConfirmProvider },
    );
  }

  it("日程に元の予定が見つかった場所だけ、「元の予定を開く」が出る。押すと、その日程を渡す", async () => {
    const onOpenSchedule = vi.fn();
    const user = userEvent.setup();
    renderWith(onOpenSchedule);
    expect(screen.queryByRole("button", { name: "どこにも無い場所の元の予定を開く" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "霊山寺の元の予定を開く" }));
    expect(onOpenSchedule).toHaveBeenCalledWith(source);
  });

  it("開く先を渡していなければ(共有しおりなど)、ボタンは出さない", () => {
    renderWith(undefined);
    expect(screen.queryByRole("button", { name: /元の予定を開く/ })).toBeNull();
  });

  it("「時間で見る」でも、元の予定が見つかった場所に出る", async () => {
    const onOpenSchedule = vi.fn();
    const user = userEvent.setup();
    renderWith(onOpenSchedule);
    await user.click(screen.getByRole("button", { name: "時間で見る" }));
    await user.click(screen.getByRole("button", { name: "霊山寺の元の予定を開く" }));
    expect(onOpenSchedule).toHaveBeenCalledWith(source);
    expect(screen.queryByRole("button", { name: "どこにも無い場所の元の予定を開く" })).toBeNull();
  });
});
