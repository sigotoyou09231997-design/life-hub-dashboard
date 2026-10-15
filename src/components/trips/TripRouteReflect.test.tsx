/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripRoutePlace, TripScheduleItem } from "../../types";

vi.mock("../../db/schema", () => ({ db: {} }));

import { TripRouteReflect } from "./TripRouteReflect";

afterEach(cleanup);

function item(over: Partial<TripScheduleItem> & { id: string; date: string; title: string }): TripScheduleItem {
  return { tripId: "t1", type: "sightseeing", createdAt: 1, ...over };
}
const place = (address: string): TripRoutePlace => ({
  id: `p-${address}`,
  tripId: "t1",
  name: address,
  address,
  sortOrder: 1,
  date: "2026-09-19",
  visited: false,
  createdAt: 1,
});

const schedule = [
  item({ id: "a", date: "2026-09-19", startTime: "09:00", title: "鶴岡八幡宮", location: "鶴岡八幡宮" }),
  item({ id: "b", date: "2026-09-19", startTime: "11:00", title: "江ノ島", location: "江ノ島" }),
  item({ id: "c", date: "2026-09-20", title: "お土産", location: "小町通り" }),
  item({ id: "d", date: "2026-09-20", title: "バス", type: "transport" }),
  item({ id: "z", date: "2030-01-01", title: "期間の外の予定", location: "どこか" }),
];

function renderList(over: { excluded?: string[]; places?: TripRoutePlace[]; onChoose?: (i: TripScheduleItem, on: boolean) => void } = {}) {
  return render(
    <TripRouteReflect
      dayList={["2026-09-19", "2026-09-20"]}
      schedule={schedule}
      places={over.places ?? [place("鶴岡八幡宮")]}
      excluded={over.excluded ?? ["c"]}
      onChoose={over.onChoose ?? (() => {})}
    />,
  );
}

describe("日程から選ぶ(予定ごとに、ルートへ入れる/入れない)", () => {
  it("日にちごとに並べ、予定ごとに2つのボタン。入っている予定は「入れる」、「入れない」にした予定は「入れない」に印が付く", () => {
    renderList();
    expect(screen.getByRole("heading", { name: /1日目/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /2日目/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /ほかの日/ })).toBeTruthy();

    const inGroup = screen.getByRole("group", { name: "鶴岡八幡宮をルートに入れるか" });
    expect(within(inGroup).getByRole("button", { name: "入れる" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(inGroup).getByRole("button", { name: "入れない" }).getAttribute("aria-pressed")).toBe("false");

    const undecided = screen.getByRole("group", { name: "江ノ島をルートに入れるか" });
    expect(within(undecided).getByRole("button", { name: "入れる" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(undecided).getByRole("button", { name: "入れない" }).getAttribute("aria-pressed")).toBe("false");

    const off = screen.getByRole("group", { name: "お土産をルートに入れるか" });
    expect(within(off).getByRole("button", { name: "入れない" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("選べない予定(地図に置ける場所が無い)にはボタンを出さず、理由を出す", () => {
    renderList();
    expect(screen.queryByRole("group", { name: "バスをルートに入れるか" })).toBeNull();
    expect(screen.getByText(/地図に置ける場所が無いので、選べません/)).toBeTruthy();
  });

  it("押した方を渡す。もう選んでいる方を押しても何も起きない", async () => {
    const user = userEvent.setup();
    const chose: [string, boolean][] = [];
    renderList({ onChoose: (target, on) => chose.push([target.id!, on]) });

    const undecided = screen.getByRole("group", { name: "江ノ島をルートに入れるか" });
    await user.click(within(undecided).getByRole("button", { name: "入れる" }));
    await user.click(within(undecided).getByRole("button", { name: "入れない" }));
    const inGroup = screen.getByRole("group", { name: "鶴岡八幡宮をルートに入れるか" });
    await user.click(within(inGroup).getByRole("button", { name: "入れる" })); // もう「入れる」
    await user.click(within(inGroup).getByRole("button", { name: "入れない" }));

    expect(chose).toEqual([
      ["b", true],
      ["b", false],
      ["a", false],
    ]);
  });

  it("予定が1つも無ければ、案内だけ出す", () => {
    render(<TripRouteReflect dayList={["2026-09-19"]} schedule={[]} places={[]} excluded={[]} onChoose={() => {}} />);
    expect(screen.getByText(/日程に予定がありません/)).toBeTruthy();
  });
});
