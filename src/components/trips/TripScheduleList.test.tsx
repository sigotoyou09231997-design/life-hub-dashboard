/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Attachment, TripExpense, TripScheduleItem } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { LONG_PRESS_MS } from "../../hooks/useLongPressReorder";
import { TripScheduleList } from "./TripScheduleList";

function item(partial: Partial<TripScheduleItem> & { id: string; title: string }): TripScheduleItem {
  return { tripId: "trip-1", date: "2026-12-27", type: "other", createdAt: 0, ...partial };
}

function renderList(items: TripScheduleItem[], handlers: Partial<React.ComponentProps<typeof TripScheduleList>> = {}) {
  return render(
    <TripScheduleList
      dayList={["2026-12-27", "2026-12-28"]}
      items={items}
      selectedDate="2026-12-27"
      onSelectDate={() => {}}
      onEdit={() => {}}
      onLocationTap={() => {}}
      onAddForDate={() => {}}
      {...handlers}
    />,
    { wrapper: ConfirmProvider },
  );
}

afterEach(cleanup);

describe("旅行の日程の時間軸", () => {
  it("1日の予定を、時刻の早い順に1本の時間軸へ並べる", () => {
    renderList([
      item({ id: "b", title: "東京発", startTime: "06:48" }),
      item({ id: "a", title: "小金井発", startTime: "04:57" }),
      item({ id: "c", title: "高松着", startTime: "11:18" }),
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/発|着/).textContent)).toEqual(["小金井発", "東京発", "高松着"]);
  });

  it("時刻は題名の横ではなく、左の列に出す(終了時刻は開始の下)", () => {
    renderList([item({ id: "a", title: "東京発", startTime: "06:48", endTime: "10:10" })]);
    const row = screen.getByRole("listitem");
    const time = row.querySelector(".trip-timeline__time")!;
    expect(time.textContent).toBe("06:48〜10:10");
    expect(time.querySelector("span")?.textContent).toBe("06:48");
    expect(time.querySelector("small")?.textContent).toBe("〜10:10");
  });

  it("時刻の無い予定は、時刻でない言葉を淡く出し、先頭に置く", () => {
    renderList([
      item({ id: "a", title: "朝食", startTime: "09:00" }),
      item({ id: "b", title: "金刀比羅宮を参拝" }),
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("金刀比羅宮を参拝")).toBeTruthy();
    const time = rows[0].querySelector(".trip-timeline__time")!;
    expect(time.textContent).toBe("時刻なし");
    expect(time.classList.contains("is-plain")).toBe(true);
  });

  it("点の色の元になる種類を、行に持たせる(バッジの文字は残す)", () => {
    renderList([item({ id: "a", title: "昼食", startTime: "12:00", type: "meal" })]);
    const row = screen.getByRole("listitem");
    expect(row.classList.contains("trip-timeline__item--meal")).toBe(true);
    // 色だけが手がかりにならないよう、種類は文字でも出す。
    expect(within(row).getByText("食事")).toBeTruthy();
  });

  it("予定が無い日は、時間軸を出さず「予定を追加」に畳む", async () => {
    const onAddForDate = vi.fn();
    const user = userEvent.setup();
    renderList([item({ id: "a", title: "朝食", startTime: "09:00" })], { onAddForDate, selectedDate: "2026-12-28" });
    expect(screen.queryByRole("list")).toBeNull();
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(onAddForDate).toHaveBeenCalledWith("2026-12-28");
  });

  it("またがる日程は、その間の日すべてに出る(初日は時刻、2日目は「終日」)", () => {
    const stay = item({ id: "stay", title: "小豆島のコテージ", endDate: "2026-12-28", startTime: "15:00" });
    renderList([stay]);
    expect(within(screen.getByRole("list")).getByText("15:00")).toBeTruthy();
    cleanup();
    renderList([stay], { selectedDate: "2026-12-28" });
    expect(within(screen.getByRole("list")).getByText("終日")).toBeTruthy();
  });

  it("行を押せば編集、場所を押せば場所の操作(従来どおり)", async () => {
    const onEdit = vi.fn();
    const onLocationTap = vi.fn();
    const user = userEvent.setup();
    const target = item({ id: "a", title: "東京発", startTime: "06:48", location: "東京駅" });
    renderList([target], { onEdit, onLocationTap });

    await user.click(screen.getByRole("button", { name: "東京発を編集" }));
    expect(onEdit).toHaveBeenCalledWith(target);

    await user.click(screen.getByRole("button", { name: "東京駅" }));
    // 押した日程の日も渡す(同じ場所に2回寄る旅行で、ルートの同じ日の方へ飛ぶため)。
    expect(onLocationTap).toHaveBeenCalledWith("東京駅", "東京発", "2026-12-27");
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("行にゴミ箱は出さない(削除は、押して開く編集の中から)", () => {
    renderList([item({ id: "a", title: "東京発", startTime: "06:48" }), item({ id: "b", title: "高松着", startTime: "11:18" })], { onReorder: () => {} });
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
  });

  it("種類の札は「その他」なら出さない(選ばなかった予定の全部に同じ札が並ぶため)", () => {
    renderList([
      item({ id: "a", title: "集合", startTime: "06:00", type: "other" }),
      item({ id: "b", title: "うどん", startTime: "12:00", type: "meal" }),
    ]);
    const [other, meal] = screen.getAllByRole("listitem");
    expect(within(other).queryByText("その他")).toBeNull();
    expect(within(meal).getByText("食事")).toBeTruthy();
  });
});

/** 見る日を、旅行の画面の代わりに持つ(実際の使われ方と同じ、選ぶと表示が変わる形)。 */
function Switchable({ items, start = "2026-12-27", days = ["2026-12-27", "2026-12-28", "2026-12-29"] }: { items: TripScheduleItem[]; start?: string; days?: string[] }) {
  const [selected, setSelected] = useState(start);
  return (
    <TripScheduleList
      dayList={days}
      items={items}
      selectedDate={selected}
      onSelectDate={setSelected}
      onEdit={() => {}}
      onLocationTap={() => {}}
      onAddForDate={() => {}}
    />
  );
}

const THREE_DAYS = [
  item({ id: "a", title: "小金井発", date: "2026-12-27", startTime: "04:57" }),
  item({ id: "b", title: "屋島を歩く", date: "2026-12-28", startTime: "10:00" }),
  item({ id: "c", title: "高松発", date: "2026-12-29", startTime: "16:00" }),
];

describe("日程を、日にちごとに切り替える", () => {
  it("日にちのチップを並べる(何日目・日付・その日の件数)。選んでいる日が分かる", () => {
    render(<Switchable items={THREE_DAYS} />, { wrapper: ConfirmProvider });
    const group = screen.getByRole("group", { name: "日にちを切り替える" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["1日目 12/27(日)1", "2日目 12/28(月)1", "3日目 12/29(火)1"]);
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
  });

  it("選んだ1日だけを出す(他の日の予定は出さない)", () => {
    render(<Switchable items={THREE_DAYS} />, { wrapper: ConfirmProvider });
    expect(screen.getByText("小金井発")).toBeTruthy();
    expect(screen.queryByText("屋島を歩く")).toBeNull();
    expect(screen.queryByText("高松発")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("チップを押すと、その日に切り替わる", async () => {
    const user = userEvent.setup();
    render(<Switchable items={THREE_DAYS} />, { wrapper: ConfirmProvider });
    await user.click(screen.getByRole("button", { name: /3日目 12\/29/ }));
    expect(screen.getByText("高松発")).toBeTruthy();
    expect(screen.queryByText("小金井発")).toBeNull();
    expect(screen.getByRole("heading", { name: /3日目/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /3日目 12\/29/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("親が選んだ日を変えれば、表示も変わる(予定を足した日へ切り替えるのに使う)", () => {
    const props = { dayList: ["2026-12-27", "2026-12-28"], items: THREE_DAYS, onSelectDate: () => {}, onEdit: () => {}, onLocationTap: () => {}, onAddForDate: () => {} };
    const { rerender } = render(<TripScheduleList {...props} selectedDate="2026-12-27" />, { wrapper: ConfirmProvider });
    expect(screen.getByText("小金井発")).toBeTruthy();
    rerender(<TripScheduleList {...props} selectedDate="2026-12-28" />);
    expect(screen.getByText("屋島を歩く")).toBeTruthy();
    expect(screen.queryByText("小金井発")).toBeNull();
  });

  it("前の日・次の日のボタンで、1日を読み終えたまま進める。端の日では、行き止まりのほうを出さない", async () => {
    const user = userEvent.setup();
    render(<Switchable items={THREE_DAYS} />, { wrapper: ConfirmProvider });
    const nav = () => screen.getByRole("navigation", { name: "前後の日へ" });
    // 1日目: 前は無い。
    expect(within(nav()).queryByRole("button", { name: /前の日/ })).toBeNull();
    await user.click(within(nav()).getByRole("button", { name: "次の日(2日目)" }));
    expect(screen.getByText("屋島を歩く")).toBeTruthy();
    // 2日目: 前も次もある。
    expect(within(nav()).getByRole("button", { name: "前の日(1日目)" })).toBeTruthy();
    await user.click(within(nav()).getByRole("button", { name: "次の日(3日目)" }));
    expect(screen.getByText("高松発")).toBeTruthy();
    // 3日目: 次は無い。
    expect(within(nav()).queryByRole("button", { name: /次の日/ })).toBeNull();
    await user.click(within(nav()).getByRole("button", { name: "前の日(2日目)" }));
    expect(screen.getByText("屋島を歩く")).toBeTruthy();
  });

  it("1日だけの旅行には、前後のボタンは出さない", () => {
    render(<Switchable items={THREE_DAYS} days={["2026-12-27"]} />, { wrapper: ConfirmProvider });
    expect(screen.queryByRole("navigation", { name: "前後の日へ" })).toBeNull();
  });

  it("旅行の期間に無い日が選ばれていたら、1日目に落とす(期間を直した直後でも、空の画面にしない)", () => {
    render(<Switchable items={THREE_DAYS} start="2027-03-01" />, { wrapper: ConfirmProvider });
    expect(screen.getByText("小金井発")).toBeTruthy();
    expect(screen.getByRole("button", { name: /1日目/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("予定の無い日のチップは、件数 0。その日を選ぶと「予定を追加」が出る", async () => {
    const user = userEvent.setup();
    render(<Switchable items={[THREE_DAYS[0]]} />, { wrapper: ConfirmProvider });
    // 「次の日(2日目)」とは別に、日にちのチップ(「2日目 12/28(月)」)を指す。
    expect(screen.getByRole("button", { name: /^2日目 12\/28/ }).textContent).toContain("0");
    await user.click(screen.getByRole("button", { name: /^2日目 12\/28/ }));
    expect(screen.getByRole("button", { name: "予定を追加" })).toBeTruthy();
  });
});

describe("移動の予定の移動手段", () => {
  it("移動の予定は、選んだ移動手段を種類の横に出す", () => {
    renderList([item({ id: "a", title: "東京→岡山 のぞみ7号", type: "transport", transportMode: "shinkansen", startTime: "06:48" })]);
    expect(within(screen.getByRole("listitem")).getByText("新幹線")).toBeTruthy();
  });

  it("移動手段を選んでいない移動や、移動以外の予定には出さない", () => {
    renderList([
      item({ id: "a", title: "高松駅→レンタカー店", type: "transport", startTime: "11:18" }),
      item({ id: "b", title: "霊山寺", type: "sightseeing", transportMode: "car", startTime: "13:15" }),
    ]);
    expect(screen.queryByText("車")).toBeNull();
    expect(screen.queryByText("新幹線")).toBeNull();
  });
});

describe("予定に貼った写真", () => {
  it("写真のある予定には、その写真を並べる(無い予定には出さない)", () => {
    Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
    const photo: Attachment = { id: "p1", ownerType: "tripSchedule", ownerId: "a", name: "うずしお.jpg", mediaType: "image/jpeg", blob: new Blob(["x"], { type: "image/jpeg" }), size: 1, createdAt: 1 };
    render(
      <TripScheduleList
        dayList={["2026-12-27"]}
        items={[item({ id: "a", title: "うずしお観潮船", startTime: "14:45" }), item({ id: "b", title: "道の駅", startTime: "15:25" })]}
        photosBySchedule={new Map([["a", [photo]]])}
        selectedDate="2026-12-27"
        onSelectDate={() => {}}
        onEdit={() => {}}
          onLocationTap={() => {}}
        onAddForDate={() => {}}
      />,
      { wrapper: ConfirmProvider },
    );
    const rows = screen.getAllByRole("listitem").filter((row) => row.classList.contains("trip-timeline__item"));
    expect(rows[0].querySelectorAll("img")).toHaveLength(1);
    expect(rows[1].querySelectorAll("img")).toHaveLength(0);
  });
});

describe("予定の費用", () => {
  it("費用のある予定には、金額と支払った人を出す", () => {
    const expense: TripExpense = { id: "e1", tripId: "trip-1", title: "新幹線", amount: 17000, category: "transport", paid: true, paidBy: "えっくん", scheduleId: "a", createdAt: 0 };
    render(
      <TripScheduleList
        dayList={["2026-12-27"]}
        items={[item({ id: "a", title: "東京→岡山", startTime: "06:48" }), item({ id: "b", title: "岡山駅", startTime: "10:05" })]}
        expenseBySchedule={new Map([["a", expense]])}
        selectedDate="2026-12-27"
        onSelectDate={() => {}}
        onEdit={() => {}}
          onLocationTap={() => {}}
        onAddForDate={() => {}}
      />,
      { wrapper: ConfirmProvider },
    );
    const rows = screen.getAllByRole("listitem").filter((row) => row.classList.contains("trip-timeline__item"));
    expect(rows[0].textContent).toContain("¥17,000・えっくん");
    expect(rows[1].textContent).not.toContain("¥");
  });
});

/** jsdom は配置を計算しないので、行は上から 50px ずつ並んでいることにする(いまの DOM の並び順で)。 */
function layoutRows() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-reorder-row]"));
    const top = rows.indexOf(this) * 50;
    return { top, bottom: top + 40, height: 40, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

/** jsdom には PointerEvent が無く、指の位置(clientY)や pointerId が渡らない。ブラウザと同じ形のものを用意する。 */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

const SAME_TIME_DAY = [
  item({ id: "boat", title: "高知→四万十の碧 乗船場所", startTime: "06:00", createdAt: 1 }),
  item({ id: "leave", title: "ホテル出発", startTime: "06:00", createdAt: 2 }),
  item({ id: "desk", title: "受付・待機", startTime: "08:15", createdAt: 3 }),
];

function renderReorderable(items: TripScheduleItem[], onReorder = vi.fn(), onEdit = vi.fn()) {
  render(
    <TripScheduleList
      dayList={["2026-12-27"]}
      items={items}
      onEdit={onEdit}
      onLocationTap={() => {}}
      onReorder={onReorder}
      onAddForDate={() => {}}
      selectedDate="2026-12-27"
      onSelectDate={() => {}}
    />,
    { wrapper: ConfirmProvider },
  );
  return { onReorder, onEdit };
}

function rowOf(title: string): HTMLElement {
  return screen.getByRole("button", { name: `${title}を編集` }).closest("li") as HTMLElement;
}

function shownTitles(): string[] {
  return Array.from(document.querySelectorAll(".trip-timeline__title")).map((el) => el.textContent!);
}

/** 長押しして、clientY の高さまで動かして離す。 */
async function longPressDrag(row: HTMLElement, fromY: number, toY: number, pointerId = 1) {
  fireEvent.pointerDown(row, { pointerId, button: 0, clientX: 10, clientY: fromY });
  act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
  fireEvent.pointerMove(row, { pointerId, clientX: 10, clientY: toY });
  await act(async () => {
    fireEvent.pointerUp(row, { pointerId, clientX: 10, clientY: toY });
  });
}

describe("予定の並べ替え(長押しして動かす)", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.useFakeTimers();
    layoutRows();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("行ごとの「↑」「↓」もつまみも、ふだんは出さない。並べ替えられることは「並べ替え」のボタンで見せる", () => {
    renderReorderable(SAME_TIME_DAY);
    expect(screen.queryByRole("button", { name: /を上へ|を下へ/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /を動かす$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "並べ替え" })).toBeTruthy();
  });

  it("「並べ替え」を押すと、各行につまみが出て、案内が1行出る。「完了」で元に戻る", () => {
    renderReorderable(SAME_TIME_DAY);
    fireEvent.click(screen.getByRole("button", { name: "並べ替え" }));
    expect(screen.getAllByRole("button", { name: /を動かす$/ })).toHaveLength(3);
    expect(screen.getByText(/を上下に動かすと、順番を変えられます/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    expect(screen.queryByRole("button", { name: /を動かす$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "並べ替え" })).toBeTruthy();
  });

  it("つまみは長押しを待たずに、押してすぐ動かせる(押しただけでは編集を開かない)", async () => {
    const { onReorder, onEdit } = renderReorderable(SAME_TIME_DAY);
    fireEvent.click(screen.getByRole("button", { name: "並べ替え" }));
    const grip = screen.getByRole("button", { name: "受付・待機を動かす" });
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 300, clientY: 120 });
    // 待たずに、もう動かしている。
    expect(rowOf("受付・待機").classList.contains("is-dragging")).toBe(true);
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 300, clientY: 5 });
    await act(async () => {
      fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 300, clientY: 5 });
    });
    fireEvent.click(grip);
    expect(onReorder).toHaveBeenLastCalledWith([
      { id: "desk", sortOrder: 1 },
      { id: "boat", sortOrder: 2 },
      { id: "leave", sortOrder: 3 },
    ]);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("つまみはキーボードの ↑ ↓ でも1つずつ動かせる(端では何もしない)", () => {
    const { onReorder } = renderReorderable(SAME_TIME_DAY);
    fireEvent.click(screen.getByRole("button", { name: "並べ替え" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "ホテル出発を動かす" }), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenLastCalledWith([
      { id: "leave", sortOrder: 1 },
      { id: "boat", sortOrder: 2 },
      { id: "desk", sortOrder: 3 },
    ]);
    fireEvent.keyDown(screen.getByRole("button", { name: "高知→四万十の碧 乗船場所を動かす" }), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it("ふだんの表示でも、長押しで並べ替えられる(近道として残す)", async () => {
    const { onReorder } = renderReorderable(SAME_TIME_DAY);
    expect(screen.queryByRole("button", { name: /を動かす$/ })).toBeNull();
    await longPressDrag(rowOf("受付・待機"), 120, 60);
    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it("長押しして1つ上へ動かすと、以前の「↑」と同じ並び順を渡す(時刻がちがっても動かせる)", async () => {
    const { onReorder } = renderReorderable(SAME_TIME_DAY);
    // 3番目(y=100〜140)を、2番目の真ん中(y=70)より上へ。
    await longPressDrag(rowOf("受付・待機"), 120, 60);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenLastCalledWith([
      { id: "boat", sortOrder: 1 },
      { id: "desk", sortOrder: 2 },
      { id: "leave", sortOrder: 3 },
    ]);
  });

  it("離れた位置へも一度で動かせる。動かしている間は、落とす位置に並べて見せる", async () => {
    const { onReorder } = renderReorderable(SAME_TIME_DAY);
    const row = rowOf("受付・待機");
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 120 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    expect(row.classList.contains("is-dragging")).toBe(true);
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 5 });
    expect(shownTitles()).toEqual(["受付・待機", "高知→四万十の碧 乗船場所", "ホテル出発"]);
    await act(async () => {
      fireEvent.pointerUp(row, { pointerId: 1, clientX: 10, clientY: 5 });
    });
    expect(onReorder).toHaveBeenLastCalledWith([
      { id: "desk", sortOrder: 1 },
      { id: "boat", sortOrder: 2 },
      { id: "leave", sortOrder: 3 },
    ]);
  });

  it("動かしている途中で指が一覧の外へ出て離れても、そこで並べ替えを終える", async () => {
    // 並びを入れ替えて見せると行の要素が DOM の中で動き、行に付けた指の捕まえが外れる。行の外で離しても取りこぼさない。
    const { onReorder } = renderReorderable(SAME_TIME_DAY);
    const row = rowOf("高知→四万十の碧 乗船場所");
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 10, clientY: 300 });
    await act(async () => {
      fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 10, clientY: 300 });
    });
    expect(onReorder).toHaveBeenLastCalledWith([
      { id: "leave", sortOrder: 1 },
      { id: "desk", sortOrder: 2 },
      { id: "boat", sortOrder: 3 },
    ]);
    expect(document.querySelector(".is-dragging")).toBeNull();
  });

  it("端末に取り消されたら(着信など)、並びは変えない", async () => {
    const { onReorder } = renderReorderable(SAME_TIME_DAY);
    const row = rowOf("高知→四万十の碧 乗船場所");
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 300 });
    await act(async () => {
      fireEvent.pointerCancel(row, { pointerId: 1 });
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(shownTitles()).toEqual(["高知→四万十の碧 乗船場所", "ホテル出発", "受付・待機"]);
  });

  it("長押しになる前に指が動いたら、スクロールとして扱い、並べ替えない", async () => {
    const { onReorder } = renderReorderable(SAME_TIME_DAY);
    const row = rowOf("ホテル出発");
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 70 });
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 110 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 140 });
    await act(async () => {
      fireEvent.pointerUp(row, { pointerId: 1, clientX: 10, clientY: 140 });
    });
    expect(onReorder).not.toHaveBeenCalled();
    expect(shownTitles()).toEqual(["高知→四万十の碧 乗船場所", "ホテル出発", "受付・待機"]);
  });

  it("ふつうに押せば編集が開く。長押しのあとの押しでは開かない(その場で離しても)", async () => {
    const { onEdit, onReorder } = renderReorderable(SAME_TIME_DAY);
    fireEvent.click(screen.getByRole("button", { name: "ホテル出発を編集" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    // 長押ししたが動かさずに離した。並びは変えず、編集も開かない。
    await longPressDrag(rowOf("ホテル出発"), 70, 70, 2);
    fireEvent.click(screen.getByRole("button", { name: "ホテル出発を編集" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onReorder).not.toHaveBeenCalled();

    // 少し経てば、また押して開ける。
    act(() => vi.advanceTimersByTime(10));
    fireEvent.click(screen.getByRole("button", { name: "ホテル出発を編集" }));
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it("予定が1つだけの日は並べ替えにしない(「並べ替え」のボタンも出さない)", () => {
    renderReorderable([item({ id: "only", title: "ホテル出発", startTime: "06:00" })]);
    expect(rowOf("ホテル出発").hasAttribute("data-reorder-row")).toBe(false);
    expect(screen.queryByRole("button", { name: "並べ替え" })).toBeNull();
  });
});
