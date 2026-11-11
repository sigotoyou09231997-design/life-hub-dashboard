/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Note } from "../../types";

// メモの「タスク化」「予定化」は、押したらお知らせと「元に戻す」が出る(第72弾)。
// db は入れ物だけの代役。入れた行を覚えて、消された行を数える。
const state = vi.hoisted(() => ({ tasks: [] as Record<string, unknown>[], events: [] as Record<string, unknown>[], deleted: [] as string[] }));

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
    calendarEvents: {
      add: async (row: Record<string, unknown>) => {
        state.events.push(row);
        return `e${state.events.length}`;
      },
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
vi.mock("../attachments/PhotoStrip", () => ({ PhotoStrip: () => null }));

import { NoteCard } from "./NoteCard";
import { ToastProvider } from "../ui/ToastProvider";

const note: Note = { id: "n1", type: "memo", title: "見積もりを出す", body: "", tags: [], pinned: false, createdAt: 0 } as Note;

beforeEach(() => {
  state.tasks.length = 0;
  state.events.length = 0;
  state.deleted.length = 0;
});
afterEach(() => cleanup());

function renderCard() {
  return render(<NoteCard note={note} onEdit={() => undefined} onDelete={() => undefined} />, { wrapper: ToastProvider });
}

describe("メモのタスク化・予定化", () => {
  it("タスク化を押すと、入ったことをお知らせし、元に戻すで今入れたタスクだけを消す", async () => {
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /タスク化/ }));
    });
    expect(state.tasks).toHaveLength(1);
    expect(await screen.findByText(/見積もりを出す」をタスクにしました/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    expect(state.deleted).toContain("t1");
  });

  it("予定化を押すと、今日の予定にしたことをお知らせする", async () => {
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /予定化/ }));
    });
    expect(state.events).toHaveLength(1);
    expect(await screen.findByText(/今日の予定にしました/)).toBeTruthy();
  });
});
