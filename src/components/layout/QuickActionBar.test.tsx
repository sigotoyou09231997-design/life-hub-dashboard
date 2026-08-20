/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/ToastProvider";
import { QuickActionBar } from "./QuickActionBar";
import { QUICK_ACTION_STORAGE_KEY } from "./quickActions";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderBar(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><QuickActionBar /></ToastProvider>
    </MemoryRouter>,
  );
}

describe("QuickActionBar customization UI", () => {
  it("replaces Gmail with Travel and persists the selection", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "すべての機能" }));
    await user.click(screen.getByRole("button", { name: "追従ボタンを編集" }));
    await user.click(screen.getByRole("button", { name: "Gmailを外す" }));
    await user.click(screen.getByRole("button", { name: "旅行を追加" }));
    await user.click(screen.getByRole("button", { name: "保存する" }));

    expect(screen.getByRole("link", { name: "旅行" }).getAttribute("href")).toBe("/trips");
    expect(screen.queryByRole("link", { name: "Gmail" })).toBeNull();
    expect(JSON.parse(localStorage.getItem(QUICK_ACTION_STORAGE_KEY) ?? "[]")).toEqual([
      "schedule",
      "money",
      "notes",
      "trips",
    ]);
  });

  it("shows the configured Travel action as active on travel routes", () => {
    localStorage.setItem(QUICK_ACTION_STORAGE_KEY, JSON.stringify(["trips", "money"]));
    const { container } = renderBar("/trips");

    const travel = screen.getByRole("link", { name: "旅行" });
    expect(travel.querySelector(".bg-teal-500")).not.toBeNull();
    expect(container.querySelector('[aria-label="追従ナビゲーション"]')?.getAttribute("style")).toContain("repeat(2");
  });
});
