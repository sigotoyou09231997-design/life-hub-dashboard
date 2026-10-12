/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobApplication } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  added: [] as JobApplication[],
  updated: [] as JobApplication[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    jobApplications: {
      add: async (row: JobApplication) => {
        mocks.added.push(row);
        return "new-job";
      },
      update: async (_id: string, row: JobApplication) => {
        mocks.updated.push(row);
        return 1;
      },
    },
    calendarEvents: { add: async () => "new-event" },
    tasks: { add: async () => "new-task" },
  },
}));

import { JobApplicationForm } from "./JobApplicationForm";

function renderForm(initial?: JobApplication) {
  return render(
    <ToastProvider>
      <JobApplicationForm initial={initial} onSaved={() => {}} onCancel={() => {}} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.added = [];
  mocks.updated = [];
});

afterEach(cleanup);

// iPhone ではシートの中のプルダウンの選択肢が欄から離れた所に出るので(2026-10-12)、ボタンにしてある。
describe("応募先の「今の段階」", () => {
  it("プルダウンではなくボタンで選び、保存される値は今までと同じ", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByRole("combobox")).toBeNull();
    // 新しく足す時の既定は「応募済み」。
    expect(screen.getByRole("button", { name: "応募済み" }).getAttribute("aria-pressed")).toBe("true");

    await user.type(screen.getByLabelText("会社名"), "株式会社ABC");
    await user.click(screen.getByRole("button", { name: "一次面接" }));
    await user.click(screen.getByRole("button", { name: "保存する" }));

    expect(mocks.added[0]).toMatchObject({ companyName: "株式会社ABC", stage: "interview1" });
  });

  it("開いた応募先の段階が、選ばれた状態で出る", async () => {
    const user = userEvent.setup();
    renderForm({ id: "job-1", companyName: "株式会社XYZ", stage: "final", createdAt: 1_000 });
    expect(screen.getByRole("button", { name: "最終面接" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "応募済み" }).getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "内定" }));
    await user.click(screen.getByRole("button", { name: "保存する" }));
    expect(mocks.updated[0].stage).toBe("offer");
  });
});
