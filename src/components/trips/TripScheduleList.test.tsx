/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripScheduleItem } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";
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
      onDelete={() => {}}
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

  it("行を押せば編集、場所を押せば場所の操作、ゴミ箱は確認のあとで消す(従来どおり)", async () => {
    const onEdit = vi.fn();
    const onLocationTap = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    const target = item({ id: "a", title: "東京発", startTime: "06:48", location: "東京駅" });
    renderList([target], { onEdit, onLocationTap, onDelete });

    await user.click(screen.getByRole("button", { name: "東京発を編集" }));
    expect(onEdit).toHaveBeenCalledWith(target);

    await user.click(screen.getByRole("button", { name: "東京駅" }));
    expect(onLocationTap).toHaveBeenCalledWith("東京駅", "東京発");
    expect(onEdit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(onDelete).toHaveBeenCalledWith("a");
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
      onDelete={() => {}}
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
    const props = { dayList: ["2026-12-27", "2026-12-28"], items: THREE_DAYS, onSelectDate: () => {}, onEdit: () => {}, onDelete: () => {}, onLocationTap: () => {}, onAddForDate: () => {} };
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
