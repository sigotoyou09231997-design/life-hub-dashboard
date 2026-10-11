/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Trip, TripScheduleItem } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";
import { TripMyMapsSheet } from "./TripMyMapsSheet";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));

// 実際のファイル保存(Blob → a.click)はjsdomに無いので、渡された中身だけ確かめる。
vi.mock("../../lib/transactionCsv", async () => {
  const actual = await vi.importActual<typeof import("../../lib/transactionCsv")>("../../lib/transactionCsv");
  return { ...actual, downloadTransactionCsv: mocks.download };
});

const TRIP: Trip = {
  id: "t1",
  name: "四国",
  destination: "徳島",
  startDate: "2026-10-12",
  endDate: "2026-10-13",
  status: "planning",
  createdAt: 1,
};

function item(overrides: Partial<TripScheduleItem>): TripScheduleItem {
  return {
    id: "s1",
    tripId: "t1",
    date: "2026-10-12",
    title: "うずしお観潮船",
    location: "鳴門市鳴門町土佐泊浦",
    type: "sightseeing",
    createdAt: 1,
    ...overrides,
  };
}

function renderSheet(schedule: TripScheduleItem[], onClose = () => {}) {
  render(
    <ToastProvider>
      <TripMyMapsSheet trip={TRIP} schedule={schedule} onClose={onClose} />
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.download.mockReset();
});

describe("TripMyMapsSheet", () => {
  it("shows how many schedule items can be placed and lists the ones that cannot", () => {
    renderSheet([
      item({ id: "a" }),
      item({ id: "b", title: "新幹線で移動", location: undefined, type: "transport" }),
    ]);
    expect(screen.getByText("1件")).toBeTruthy();
    expect(screen.getByText(/場所が空のため載せられない日程（1件）/)).toBeTruthy();
    expect(screen.getByText(/新幹線で移動/)).toBeTruthy();
  });

  it("does not show the skipped box when every item has a location", () => {
    renderSheet([item({ id: "a" })]);
    expect(screen.queryByText(/載せられない日程/)).toBeNull();
  });

  it("downloads one combined CSV under the trip's name and closes", () => {
    const onClose = vi.fn();
    renderSheet([item({ id: "a" })], onClose);
    fireEvent.click(screen.getByRole("button", { name: /1つにまとめて書き出す/ }));
    expect(mocks.download).toHaveBeenCalledTimes(1);
    const [csv, filename] = mocks.download.mock.calls[0];
    expect(filename).toBe("四国-マイマップ用.csv");
    expect(csv).toContain("鳴門市鳴門町土佐泊浦,うずしお観潮船,1日目,2026-10-12");
    expect(onClose).toHaveBeenCalled();
  });

  it("downloads one CSV per day when asked to split by day", async () => {
    const onClose = vi.fn();
    renderSheet(
      [item({ id: "a" }), item({ id: "b", title: "二日目の場所", date: "2026-10-13", location: "徳島駅" })],
      onClose,
    );
    fireEvent.click(screen.getByRole("button", { name: /日ごとに分けて書き出す（2ファイル）/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.download.mock.calls.map((call) => call[1])).toEqual(["1日目-四国.csv", "2日目-四国.csv"]);
    expect(mocks.download.mock.calls[1][0]).toContain("徳島駅,二日目の場所,2日目,2026-10-13");
  });

  it("disables both buttons when nothing has a location", () => {
    renderSheet([item({ location: undefined })]);
    const byDay = screen.getByRole("button", { name: /日ごとに分けて書き出す/ }) as HTMLButtonElement;
    const whole = screen.getByRole("button", { name: /1つにまとめて書き出す/ }) as HTMLButtonElement;
    expect(byDay.disabled).toBe(true);
    expect(whole.disabled).toBe(true);
    fireEvent.click(byDay);
    fireEvent.click(whole);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("tells the user to uncheck a pre-selected column such as the date", () => {
    renderSheet([item({ id: "a" })]);
    expect(screen.getByText(/最初から別の列（「日付」など）にチェックが入っている/)).toBeTruthy();
  });

  it("explains how to switch an imported layer from uniform to individual style", () => {
    renderSheet([item({ id: "a" })]);
    expect(screen.getByText(/「場所のグループ化方法」で「個別スタイル」を選ぶ/)).toBeTruthy();
  });
});
