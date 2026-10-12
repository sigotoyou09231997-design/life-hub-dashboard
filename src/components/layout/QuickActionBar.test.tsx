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
  it("replaces Memo with Travel and persists the selection", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "すべての機能" }));
    await user.click(screen.getByRole("button", { name: "下のナビの並びを編集" }));
    await user.click(screen.getByRole("button", { name: "メモを外す" }));
    await user.click(screen.getByRole("button", { name: "旅行を追加" }));
    await user.click(screen.getByRole("button", { name: "保存する" }));

    expect(screen.getByRole("link", { name: "旅行" }).getAttribute("href")).toBe("/trips");
    expect(screen.queryByRole("link", { name: "メモ" })).toBeNull();
    expect(JSON.parse(localStorage.getItem(QUICK_ACTION_STORAGE_KEY) ?? "[]")).toEqual([
      "home",
      "schedule",
      "money",
      "trips",
    ]);
  });

  it("starts with ホーム・予定・お金管理・メモ and a fixed すべて at the end", () => {
    renderBar("/");
    const nav = screen.getByRole("navigation", { name: "追従ナビゲーション" });
    const labels = Array.from(nav.querySelectorAll("a, button")).map((el) => el.textContent);
    expect(labels).toEqual(["ホーム", "予定", "お金管理", "メモ", "すべて"]);
    expect(screen.getByRole("link", { name: "ホーム" }).className).toContain("is-active");
  });

  it("lights up すべて when the current page is not in the nav", () => {
    localStorage.setItem(QUICK_ACTION_STORAGE_KEY, JSON.stringify(["schedule", "money", "gmail", "trips"]));
    renderBar("/records/notes");
    expect(screen.getByRole("button", { name: "すべての機能" }).className).toContain("is-active");
    expect(screen.getByRole("link", { name: "予定" }).className).not.toContain("is-active");
  });

  it("shows the configured Travel action as active on travel routes", () => {
    localStorage.setItem(QUICK_ACTION_STORAGE_KEY, JSON.stringify(["trips", "money"]));
    const { container } = renderBar("/trips");

    const travel = screen.getByRole("link", { name: "旅行" });
    expect(travel.querySelector(".bg-teal-500")).not.toBeNull();
    // 2つ＋右端の「すべて」で3列
    expect(container.querySelector('[aria-label="追従ナビゲーション"]')?.getAttribute("style")).toContain("repeat(3");
  });
});
