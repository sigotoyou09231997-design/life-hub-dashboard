/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ updated: [] as unknown[][], added: [] as unknown[] }));

vi.mock("../../db/schema", () => ({
  db: {
    tripPackingItems: {
      update: async (...args: unknown[]) => {
        mocks.updated.push(args);
      },
      add: async (record: unknown) => {
        mocks.added.push(record);
        return "new-id";
      },
    },
  },
}));

import { TripPackingForm } from "./TripPackingForm";

afterEach(() => {
  cleanup();
  mocks.updated = [];
  mocks.added = [];
});

describe("持ち物の入力: カテゴリ", () => {
  it("カテゴリはプルダウンではなく、全部並べたボタンで選ぶ(iPhone で選択肢が離れた所に出たため)", () => {
    render(<TripPackingForm tripId="t1" onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "必需品" }).getAttribute("aria-pressed")).toBe("true");
    for (const label of ["衣類", "電子機器", "書類", "その他"]) expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  it("選んだカテゴリで保存し、種類を変えたら並び順は持ち込まない", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <TripPackingForm
        tripId="t1"
        initial={{ id: "p1", tripId: "t1", title: "財布", category: "essentials", checked: false, sortOrder: 2, createdAt: 1 }}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "衣類" }));
    expect(screen.getByRole("button", { name: "衣類" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated).toEqual([["p1", expect.objectContaining({ title: "財布", category: "clothing", sortOrder: undefined })]]);
    expect(onSaved).toHaveBeenCalled();
  });
});
