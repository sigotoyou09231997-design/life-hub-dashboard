/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ tasks: [] as Record<string, unknown>[], deleted: [] as string[] }));

vi.mock("../../db/schema", () => ({
  db: {
    tasks: {
      add: async (row: Record<string, unknown>) => {
        state.tasks.push(row);
        return `t${state.tasks.length}`;
      },
      where: () => ({ equals: () => ({ toArray: async () => [] }) }),
      bulkDelete: async () => undefined,
      delete: async (id: string) => {
        state.deleted.push(id);
      },
    },
  },
}));
vi.mock("../../lib/placeReminders", () => ({ deletePlaceRemindersFor: async () => undefined }));
vi.mock("../../lib/eventMailLink", () => ({ deleteEventMailLinks: async () => undefined }));
vi.mock("../../lib/attachments", () => ({ deleteAttachmentsFor: async () => undefined }));
vi.mock("../../lib/currency", () => ({ deleteCurrencyFor: async () => undefined }));
vi.mock("../../lib/projectTags", () => ({ deleteProjectTagFor: async () => undefined }));

import { MemoTaskSheet } from "./MemoTaskSheet";
import { ToastProvider } from "../ui/ToastProvider";

beforeEach(() => {
  state.tasks.length = 0;
  state.deleted.length = 0;
});
afterEach(() => cleanup());

function renderSheet(onTitleOnly = vi.fn()) {
  const onClose = vi.fn();
  render(
    <MemoTaskSheet open onClose={onClose} title="打ち合わせ" body={"・見積もりを出す\n・資料を送る\n・日程を決める"} onTitleOnly={onTitleOnly} />,
    { wrapper: ToastProvider },
  );
  return { onClose, onTitleOnly };
}

describe("箇条書きのメモをまとめてタスクにする", () => {
  it("行が全部選ばれた状態で開き、外した行は入れない", async () => {
    const { onClose } = renderSheet();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: /資料を送る/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "2件をタスクにする" }));
    });
    expect(state.tasks.map((task) => task.title)).toEqual(["見積もりを出す", "日程を決める"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("入れたあとの「元に戻す」で、今入れた分をまとめて消す", async () => {
    renderSheet();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "3件をタスクにする" }));
    });
    expect(await screen.findByText("3件のタスクにしました")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    expect(state.deleted).toEqual(["t1", "t2", "t3"]);
  });

  it("全部外すと入れるボタンが押せない。「1件だけにする」は今までのタスク化に戻る", () => {
    const { onTitleOnly, onClose } = renderSheet();
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect((screen.getByRole("button", { name: "0件をタスクにする" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /1件だけにする/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onTitleOnly).toHaveBeenCalled();
  });
});
