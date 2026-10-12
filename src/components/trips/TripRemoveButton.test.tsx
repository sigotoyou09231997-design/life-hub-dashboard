/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Trip } from "../../types";
import { writeSharedOwners } from "../../lib/sharedTrips";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { TripRemoveButton } from "./TripRemoveButton";

const trip = (id: string): Trip => ({ id, name: "四国旅行", destination: "高松", startDate: "2026-12-27", endDate: "2027-01-02", status: "planning" }) as Trip;

describe("TripRemoveButton", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("自分の旅行には、削除ボタンが出る", () => {
    render(<TripRemoveButton trip={trip("mine")} onDelete={vi.fn()} />, { wrapper: ConfirmProvider });
    expect(screen.getByRole("button", { name: "「四国旅行」を削除" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: /共有された旅行/ })).toBeNull();
  });

  it("招かれて一緒に編集している旅行には、削除ボタンの代わりに「共有」の印が出る(参加者は消せない)", () => {
    writeSharedOwners(new Map([["shared", "owner"]]));
    render(<TripRemoveButton trip={trip("shared")} onDelete={vi.fn()} />, { wrapper: ConfirmProvider });
    expect(screen.queryByRole("button", { name: /削除/ })).toBeNull();
    expect(screen.getByRole("img", { name: /共有された旅行/ })).toBeTruthy();
  });

  it("参加状況が変わったら、画面の印もその場で変わる", () => {
    render(<TripRemoveButton trip={trip("t")} onDelete={vi.fn()} />, { wrapper: ConfirmProvider });
    expect(screen.queryByRole("img", { name: /共有された旅行/ })).toBeNull();
    act(() => writeSharedOwners(new Map([["t", "owner"]])));
    expect(screen.getByRole("img", { name: /共有された旅行/ })).toBeTruthy();
  });
});
