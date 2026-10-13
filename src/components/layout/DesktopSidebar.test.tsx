/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { saveHiddenFeatures } from "../../lib/hiddenFeatures";
import { DesktopSidebar } from "./DesktopSidebar";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function names(): string[] {
  const nav = screen.getByRole("navigation");
  return Array.from(nav.querySelectorAll("a")).map((link) => link.getAttribute("aria-label") ?? "");
}

describe("PC のサイドバー", () => {
  it("何も隠していなければ、全部並ぶ", () => {
    render(<MemoryRouter><DesktopSidebar /></MemoryRouter>);
    expect(names()).toEqual(["ホーム", "予定・タスク", "お金管理", "メモ・リスト", "Gmail", "旅行計画", "ふりかえり", "設定"]);
  });

  it("設定の「使う機能」で隠した機能は出さない(ふりかえりも)。ホームと設定は残る", () => {
    saveHiddenFeatures(["gmail", "review", "money"]);
    render(<MemoryRouter><DesktopSidebar /></MemoryRouter>);
    expect(names()).toEqual(["ホーム", "予定・タスク", "メモ・リスト", "旅行計画", "設定"]);
  });

  it("全部隠しても、ホームと設定は出る", () => {
    saveHiddenFeatures(["schedule", "money", "notes", "gmail", "trips", "review"]);
    render(<MemoryRouter><DesktopSidebar /></MemoryRouter>);
    expect(names()).toEqual(["ホーム", "設定"]);
  });
});
