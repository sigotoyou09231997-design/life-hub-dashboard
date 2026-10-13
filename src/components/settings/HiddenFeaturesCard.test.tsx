/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ pushed: [] as string[][] }));
vi.mock("../../lib/hiddenFeaturesSync", () => ({ pushHiddenFeatures: async (hidden: string[]) => void mocks.pushed.push(hidden) }));

import { loadHiddenFeatures, saveHiddenFeatures } from "../../lib/hiddenFeatures";
import { HiddenFeaturesCard } from "./HiddenFeaturesCard";

beforeEach(() => {
  localStorage.clear();
  mocks.pushed = [];
});
afterEach(cleanup);

const row = (name: string) => screen.getByRole("switch", { name: new RegExp(name) });

describe("設定の「使う機能」", () => {
  it("6つの機能が、ぜんぶオンで並ぶ。ホームと設定は並ばない(隠せない)", () => {
    render(<HiddenFeaturesCard />);
    expect(screen.getAllByRole("switch").map((el) => el.getAttribute("aria-checked"))).toEqual(["true", "true", "true", "true", "true", "true"]);
    expect(screen.queryByRole("switch", { name: /ホーム/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: /設定/ })).toBeNull();
    expect(screen.getByText(/データは消えません/)).toBeTruthy();
  });

  it("オフにすると、その機能を隠す設定を覚えて、アカウントに送る。オンに戻すと、また出る", async () => {
    const user = userEvent.setup();
    render(<HiddenFeaturesCard />);
    await user.click(row("Gmail"));
    expect(loadHiddenFeatures()).toEqual(["gmail"]);
    expect(row("Gmail").getAttribute("aria-checked")).toBe("false");
    await user.click(row("旅行計画"));
    expect(mocks.pushed).toEqual([["gmail"], ["gmail", "trips"]]);
    await user.click(row("Gmail"));
    expect(loadHiddenFeatures()).toEqual(["trips"]);
    expect(row("Gmail").getAttribute("aria-checked")).toBe("true");
    expect(mocks.pushed.at(-1)).toEqual(["trips"]);
  });

  it("もう隠してある機能は、オフで出る", () => {
    saveHiddenFeatures(["notes", "review"]);
    render(<HiddenFeaturesCard />);
    expect(row("メモ・リスト").getAttribute("aria-checked")).toBe("false");
    expect(row("ふりかえり").getAttribute("aria-checked")).toBe("false");
    expect(row("予定・タスク").getAttribute("aria-checked")).toBe("true");
  });
});
