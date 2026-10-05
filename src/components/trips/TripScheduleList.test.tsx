/** @vitest-environment jsdom */
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
    renderList([item({ id: "a", title: "朝食", startTime: "09:00" })], { onAddForDate });
    expect(screen.getAllByRole("list")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(onAddForDate).toHaveBeenCalledWith("2026-12-28");
  });

  it("またがる日程は、その間の日すべての時間軸に出る", () => {
    renderList([item({ id: "stay", title: "小豆島のコテージ", endDate: "2026-12-28", startTime: "15:00" })]);
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(within(lists[0]).getByText("15:00")).toBeTruthy();
    expect(within(lists[1]).getByText("終日")).toBeTruthy();
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
