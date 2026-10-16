/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// 済んだ2つ(給与・支出)と、残り3つ(予定・自宅の住所・Googleカレンダー)。
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => ({ salary: true, expense: true, event: false, googleCalendar: false }),
}));
vi.mock("../../db/schema", () => ({ db: {} }));
vi.mock("../../lib/googleCalendar", () => ({ isCalendarSyncEnabled: () => false }));
vi.mock("../../lib/homePlace", () => ({ useHomeAddress: () => "" }));
vi.mock("../../hooks/useHiddenFeatures", () => ({ useHiddenFeatures: () => [] }));
vi.mock("../layout/AddChooser", () => ({ openQuickAdd: vi.fn() }));
vi.mock("../ui/toastStore", () => ({ showToast: vi.fn() }));
vi.mock("../../lib/setupChecklist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/setupChecklist")>()),
  isSetupChecklistSuppressed: () => false,
  markSetupChecklistDone: vi.fn(),
}));

import { SetupChecklist } from "./SetupChecklist";

afterEach(cleanup);

describe("ホームの「LIFE HUB をそろえる」(第6弾 D-7)", () => {
  it("済んだ項目は「2つ済み」の1行に畳み、押すと開く。残りはカードで並ぶ", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SetupChecklist />
      </MemoryRouter>,
    );
    expect(screen.getByText("2/5 済み・あと3つ")).toBeTruthy();
    expect(document.querySelectorAll(".lh-setup__todo .lh-setup__row")).toHaveLength(3);
    expect(screen.getAllByText("はじめる")).toHaveLength(3);

    const toggle = screen.getByRole("button", { name: /2つ済み/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const doneList = document.getElementById("lh-setup-done-list")!;
    expect(doneList.hasAttribute("hidden")).toBe(true);
    expect(doneList.querySelectorAll("li")).toHaveLength(2);

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(doneList.hasAttribute("hidden")).toBe(false);
  });
});
