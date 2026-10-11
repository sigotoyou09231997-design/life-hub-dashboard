/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Trip } from "../../types";

const mocks = vi.hoisted(() => ({ updated: [] as [string, unknown][], added: [] as unknown[] }));
vi.mock("../../db/schema", () => ({
  db: {
    trips: {
      update: async (id: string, row: unknown) => void mocks.updated.push([id, row]),
      add: async (row: unknown) => {
        mocks.added.push(row);
        return "new-trip";
      },
    },
  },
}));

import { TripForm } from "./TripForm";

const trip: Trip = { id: "t1", name: "四国", destination: "高松", startDate: "2026-12-27", endDate: "2027-01-02", status: "planning", createdAt: 1, members: ["ふなだ"] };

beforeEach(() => {
  mocks.updated = [];
  mocks.added = [];
});
afterEach(cleanup);

describe("旅行の編集: 参加者", () => {
  it("名前を足して(Enter でも)、外して、保存する", async () => {
    const user = userEvent.setup();
    render(<TripForm initial={trip} onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("ふなだ")).toBeTruthy();
    await user.type(screen.getByLabelText("参加者の名前"), "えっくん");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await user.type(screen.getByLabelText("参加者の名前"), "たろう{Enter}");
    await user.click(screen.getByRole("button", { name: "ふなだを外す" }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated[0][1]).toMatchObject({ members: ["えっくん", "たろう"] });
  });

  it("同じ名前は2回入らず、全員外せば参加者は無しになる", async () => {
    const user = userEvent.setup();
    render(<TripForm initial={trip} onSaved={() => {}} onCancel={() => {}} />);
    await user.type(screen.getByLabelText("参加者の名前"), "ふなだ{Enter}");
    expect(screen.getAllByText("ふなだ")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "ふなだを外す" }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect((mocks.updated[0][1] as Trip).members).toBeUndefined();
  });
});
