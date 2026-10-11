/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripScheduleItem } from "../../types";

const mocks = vi.hoisted(() => ({ added: [] as unknown[], updated: [] as [string, unknown][] }));

vi.mock("../../db/schema", () => ({
  db: {
    tripSchedule: {
      add: async (row: unknown) => void mocks.added.push(row),
      update: async (id: string, row: unknown) => void mocks.updated.push([id, row]),
    },
  },
}));

import { TripScheduleForm } from "./TripScheduleForm";

beforeEach(() => {
  mocks.added = [];
  mocks.updated = [];
});
afterEach(cleanup);

function renderForm(initial?: TripScheduleItem) {
  const saved = vi.fn();
  render(<TripScheduleForm tripId="t1" initial={initial} defaultDate="2026-12-27" onSaved={saved} onCancel={() => {}} />);
  return saved;
}

describe("旅行の予定の入力: 移動手段", () => {
  it("種類が「移動」の時だけ、移動手段を選ぶ欄が出る", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByText("移動手段")).toBeNull();
    await user.selectOptions(screen.getByRole("combobox"), "transport");
    expect(screen.getByText("移動手段")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新幹線" })).toBeTruthy();
  });

  it("選んだ移動手段を保存する", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByPlaceholderText("例: 五稜郭"), "東京→岡山");
    await user.selectOptions(screen.getByRole("combobox"), "transport");
    await user.click(screen.getByRole("button", { name: "新幹線" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.added).toEqual([expect.objectContaining({ title: "東京→岡山", type: "transport", transportMode: "shinkansen" })]);
  });

  it("「未定」に戻したり、種類を移動から変えたりしたら、移動手段は残さない", async () => {
    const user = userEvent.setup();
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-27", title: "高松→鳴門", type: "transport", transportMode: "car", createdAt: 1 });
    expect(screen.getByRole("button", { name: "車" }).getAttribute("aria-pressed")).toBe("true");
    await user.selectOptions(screen.getByRole("combobox"), "sightseeing");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated[0][1]).toMatchObject({ type: "sightseeing", transportMode: undefined });
  });
});
